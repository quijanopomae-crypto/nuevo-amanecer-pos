#!/usr/bin/env python3
import argparse
import base64
import hashlib
import json
import math
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path


def fail(message):
    raise RuntimeError(message)


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def encode_turso(value):
    if value is None:
        return {"type": "null"}
    if isinstance(value, bool):
        return {"type": "integer", "value": "1" if value else "0"}
    if isinstance(value, int):
        return {"type": "integer", "value": str(value)}
    if isinstance(value, float):
        return {"type": "float", "value": value}
    if isinstance(value, (bytes, bytearray, memoryview)):
        raw = bytes(value)
        return {"type": "blob", "base64": base64.b64encode(raw).decode("ascii").rstrip("=")}
    return {"type": "text", "value": str(value)}


def decode_turso(value):
    if not value or value.get("type") == "null":
        return None
    kind = value.get("type")
    if kind == "integer":
        return int(value["value"])
    if kind == "float":
        return float(value["value"])
    if kind == "text":
        return value.get("value", "")
    if kind == "blob":
        raw = value.get("base64", "")
        raw += "=" * ((4 - len(raw) % 4) % 4)
        return base64.b64decode(raw)
    fail("unsupported Turso result value type: " + str(kind))


def canonical_value(value):
    if value is None:
        return ["n", None]
    if isinstance(value, bool):
        return ["i", "1" if value else "0"]
    if isinstance(value, int):
        return ["i", str(value)]
    if isinstance(value, float):
        if not math.isfinite(value):
            fail("non-finite float is not allowed")
        # LibSQL/Turso crosses a JSON protocol boundary. Preserve strict parity for
        # all non-REAL values while normalizing sub-ULP decimal noise in REALs.
        return ["f", format(value, ".15g")]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return ["b", base64.b64encode(bytes(value)).decode("ascii")]
    return ["t", str(value)]


def rows_digest(rows):
    row_hashes = []
    for row in rows:
        payload = json.dumps([canonical_value(v) for v in row], ensure_ascii=False, separators=(",", ":"))
        row_hashes.append(hashlib.sha256(payload.encode("utf-8")).hexdigest())
    row_hashes.sort()
    joined = "\n".join(row_hashes).encode("ascii")
    return hashlib.sha256(joined).hexdigest()


class Turso:
    def __init__(self, url, token):
        raw = str(url or "").strip()
        if raw.startswith("libsql://"):
            raw = "https://" + raw[len("libsql://"):]
        if not raw.startswith("https://"):
            fail("TURSO_PROD_DATABASE_URL must use libsql:// or https://")
        self.base = raw.rstrip("/")
        self.token = str(token or "").strip()
        if not self.token:
            fail("TURSO_PROD_AUTH_TOKEN is required")

    def pipeline(self, requests):
        payload = json.dumps({"baton": None, "requests": requests}).encode("utf-8")
        req = urllib.request.Request(
            self.base + "/v3/pipeline",
            data=payload,
            method="POST",
            headers={
                "authorization": "Bearer " + self.token,
                "content-type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            fail("Turso HTTP %s: %s" % (exc.code, body[:500]))
        return body

    def execute(self, sql, args=None, want_rows=True):
        body = self.pipeline([
            {
                "type": "execute",
                "stmt": {
                    "sql": str(sql),
                    "args": [encode_turso(v) for v in (args or [])],
                    "want_rows": bool(want_rows),
                },
            },
            {"type": "close"},
        ])
        item = (body.get("results") or [None])[0]
        if not item or item.get("type") != "ok" or (item.get("response") or {}).get("type") != "execute":
            fail("Turso SQL failed: " + json.dumps(item, separators=(",", ":"))[:700])
        result = item["response"].get("result") or {}
        cols = [(x or {}).get("name") or ("column_%d" % i) for i, x in enumerate(result.get("cols") or [])]
        rows = []
        for values in result.get("rows") or []:
            rows.append(tuple(decode_turso(v) for v in values))
        return cols, rows, result

    def batch(self, statements, foreign_keys_off=False):
        if not statements:
            return
        steps = []
        if foreign_keys_off:
            steps.append({"stmt": {"sql": "PRAGMA foreign_keys=OFF", "args": [], "want_rows": False}})
        begin_index = len(steps)
        condition = None if begin_index == 0 else {"type": "ok", "step": begin_index - 1}
        begin = {"stmt": {"sql": "BEGIN IMMEDIATE", "args": [], "want_rows": False}}
        if condition:
            begin["condition"] = condition
        steps.append(begin)
        previous = len(steps) - 1
        for sql, args in statements:
            steps.append({
                "condition": {"type": "ok", "step": previous},
                "stmt": {
                    "sql": str(sql),
                    "args": [encode_turso(v) for v in args],
                    "want_rows": False,
                },
            })
            previous = len(steps) - 1
        commit_index = len(steps)
        steps.append({
            "condition": {"type": "ok", "step": previous},
            "stmt": {"sql": "COMMIT", "args": [], "want_rows": False},
        })
        steps.append({
            "condition": {"type": "not", "cond": {"type": "ok", "step": commit_index}},
            "stmt": {"sql": "ROLLBACK", "args": [], "want_rows": False},
        })
        body = self.pipeline([{"type": "batch", "batch": {"steps": steps}}, {"type": "close"}])
        item = (body.get("results") or [None])[0]
        if not item or item.get("type") != "ok" or (item.get("response") or {}).get("type") != "batch":
            fail("Turso batch failed: " + json.dumps(item, separators=(",", ":"))[:700])
        batch = item["response"].get("result") or {}
        errors = batch.get("step_errors") or []
        for index, error in enumerate(errors):
            if error:
                fail("Turso batch step %d failed: %s" % (index, json.dumps(error, separators=(",", ":"))[:700]))
        if not (batch.get("step_results") or [])[commit_index]:
            fail("Turso batch did not commit")


def local_integrity(conn):
    quick = conn.execute("PRAGMA quick_check").fetchone()
    if not quick or str(quick[0]).lower() != "ok":
        fail("local SQLite quick_check failed: " + str(quick))
    fk = conn.execute("PRAGMA foreign_key_check").fetchall()
    if fk:
        fail("local SQLite foreign_key_check has %d violations" % len(fk))


def local_schema(conn):
    rows = conn.execute(
        """
        SELECT type, name, tbl_name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
          AND type IN ('table','index','view','trigger')
        ORDER BY CASE type
          WHEN 'table' THEN 1
          WHEN 'index' THEN 2
          WHEN 'view' THEN 3
          WHEN 'trigger' THEN 4
          ELSE 9 END, name
        """
    ).fetchall()
    out = {"table": [], "index": [], "view": [], "trigger": []}
    for row in rows:
        out[row[0]].append({"name": row[1], "table": row[2], "sql": row[3]})
    return out


def insertable_columns(conn, table):
    rows = conn.execute("PRAGMA table_xinfo(%s)" % quote_ident(table)).fetchall()
    cols = []
    for row in rows:
        # cid,name,type,notnull,dflt_value,pk,hidden
        hidden = int(row[6] or 0) if len(row) > 6 else 0
        if hidden == 0:
            cols.append(str(row[1]))
    if not cols:
        fail("table has no insertable columns: " + table)
    return cols


def local_rows(conn, table, columns):
    sql = "SELECT %s FROM %s" % (
        ",".join(quote_ident(c) for c in columns),
        quote_ident(table),
    )
    return [tuple(row) for row in conn.execute(sql).fetchall()]


def remote_rows(turso, table, columns):
    sql = "SELECT %s FROM %s" % (
        ",".join(quote_ident(c) for c in columns),
        quote_ident(table),
    )
    _, rows, _ = turso.execute(sql)
    return rows


def ensure_remote_empty(turso):
    _, rows, _ = turso.execute(
        """
        SELECT COUNT(*)
        FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
          AND type IN ('table','index','view','trigger')
        """
    )
    count = int(rows[0][0] if rows else 0)
    if count != 0:
        fail("Turso candidate is not empty; refusing import (objects=%d)" % count)


def create_tables(turso, schema):
    for item in schema["table"]:
        turso.execute(item["sql"], want_rows=False)


def copy_table(turso, conn, table, chunk_size):
    columns = insertable_columns(conn, table)
    rows = local_rows(conn, table, columns)
    if not rows:
        return 0, rows_digest([])
    sql = "INSERT INTO %s (%s) VALUES (%s)" % (
        quote_ident(table),
        ",".join(quote_ident(c) for c in columns),
        ",".join("?%d" % (i + 1) for i in range(len(columns))),
    )
    for start in range(0, len(rows), chunk_size):
        chunk = rows[start:start + chunk_size]
        turso.batch([(sql, list(row)) for row in chunk], foreign_keys_off=True)
    return len(rows), rows_digest(rows)


def copy_sqlite_sequence(turso, conn):
    exists = conn.execute(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
    ).fetchone()[0]
    if not exists:
        return
    rows = conn.execute("SELECT name, seq FROM sqlite_sequence ORDER BY name").fetchall()
    if not rows:
        return
    statements = [("DELETE FROM sqlite_sequence", [])]
    statements.extend([("INSERT INTO sqlite_sequence(name,seq) VALUES (?1,?2)", [r[0], r[1]]) for r in rows])
    turso.batch(statements, foreign_keys_off=True)


def create_secondary_objects(turso, schema):
    for kind in ("index", "view", "trigger"):
        for item in schema[kind]:
            turso.execute(item["sql"], want_rows=False)


def verify_remote_integrity(turso):
    _, quick, _ = turso.execute("PRAGMA quick_check")
    if not quick or str(quick[0][0]).lower() != "ok":
        fail("remote Turso quick_check failed: " + str(quick[:3]))
    _, fk, _ = turso.execute("PRAGMA foreign_key_check")
    if fk:
        fail("remote Turso foreign_key_check has %d violations" % len(fk))


def compare_all_tables(turso, conn, schema, local_digests):
    mismatches = []
    for item in schema["table"]:
        table = item["name"]
        columns = insertable_columns(conn, table)
        local = local_rows(conn, table, columns)
        remote = remote_rows(turso, table, columns)
        local_digest = local_digests[table]
        remote_digest = rows_digest(remote)
        if len(local) != len(remote) or local_digest != remote_digest:
            mismatches.append({
                "table": table,
                "local_count": len(local),
                "remote_count": len(remote),
                "local_digest": local_digest,
                "remote_digest": remote_digest,
            })
    if mismatches:
        fail("Turso parity mismatch: " + json.dumps(mismatches[:10], separators=(",", ":")))
    return len(schema["table"])


def compare_schema_objects(turso, schema):
    expected = sorted(
        (kind, item["name"])
        for kind in ("table", "index", "view", "trigger")
        for item in schema[kind]
    )
    _, rows, _ = turso.execute(
        """
        SELECT type, name
        FROM sqlite_master
        WHERE sql IS NOT NULL
          AND name NOT LIKE 'sqlite_%'
          AND type IN ('table','index','view','trigger')
        ORDER BY type, name
        """
    )
    observed = sorted((str(r[0]), str(r[1])) for r in rows)
    if expected != observed:
        missing = sorted(set(expected) - set(observed))
        extra = sorted(set(observed) - set(expected))
        fail("schema parity mismatch: missing=%s extra=%s" % (missing[:20], extra[:20]))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sqlite", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--chunk-size", type=int, default=80)
    parser.add_argument("--verify-existing", action="store_true")
    args = parser.parse_args()

    if args.chunk_size < 1 or args.chunk_size > 200:
        fail("chunk-size must be 1..200")
    path = Path(args.sqlite)
    if not path.is_file() or path.stat().st_size == 0:
        fail("SQLite candidate file missing or empty")

    conn = sqlite3.connect("file:%s?mode=ro" % path.as_posix(), uri=True)
    conn.row_factory = sqlite3.Row
    try:
        local_integrity(conn)
        schema = local_schema(conn)
        if not schema["table"]:
            fail("source SQLite contains no user tables")

        turso = Turso(args.url, args.token)

        print("TURSO_PROD_CANDIDATE_SOURCE_INTEGRITY=PASS")
        print("TURSO_PROD_CANDIDATE_TABLES=%d" % len(schema["table"]))

        local_digests = {}
        total_rows = 0

        if args.verify_existing:
            for item in schema["table"]:
                rows = local_rows(conn, item["name"], insertable_columns(conn, item["name"]))
                local_digests[item["name"]] = rows_digest(rows)
                total_rows += len(rows)
        else:
            ensure_remote_empty(turso)
            print("TURSO_PROD_CANDIDATE_REMOTE_EMPTY=PASS")
            create_tables(turso, schema)
            for item in schema["table"]:
                count, digest = copy_table(turso, conn, item["name"], args.chunk_size)
                local_digests[item["name"]] = digest
                total_rows += count
            copy_sqlite_sequence(turso, conn)
            create_secondary_objects(turso, schema)

        verify_remote_integrity(turso)
        compare_schema_objects(turso, schema)
        verified_tables = compare_all_tables(turso, conn, schema, local_digests)

        print("TURSO_PROD_CANDIDATE_REMOTE_INTEGRITY=PASS")
        print("TURSO_PROD_CANDIDATE_SCHEMA_PARITY=PASS")
        print("TURSO_PROD_CANDIDATE_CONTENT_PARITY=PASS")
        print("TURSO_PROD_CANDIDATE_VERIFIED_TABLES=%d" % verified_tables)
        print("TURSO_PROD_CANDIDATE_VERIFIED_ROWS=%d" % total_rows)
        if args.verify_existing:
            print("TURSO_PROD_CANDIDATE_VERIFY_EXISTING=PASS")
        else:
            print("TURSO_PROD_CANDIDATE_SEED=PASS")
    finally:
        conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("TURSO_PROD_CANDIDATE_SEED=FAIL", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        sys.exit(1)
