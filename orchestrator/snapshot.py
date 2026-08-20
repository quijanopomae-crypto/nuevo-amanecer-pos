"""Reproducible INFRA-STABLE snapshot metadata and digest validation."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from orchestrator.io_atomic import atomic_write_json
from orchestrator.schemas.validate_manifest import compute_manifest_digest, load_manifest


SNAPSHOT_FIELDS = frozenset(
    {
        "version",
        "commit",
        "target_base_commit",
        "manifest_digest",
        "file_digest_canonicalization",
        "file_digests",
        "test_result",
        "created_at",
    }
)
TEST_RESULT_FIELDS = frozenset({"methods", "pass", "fail", "blocked", "command"})


class SnapshotValidationError(ValueError):
    pass


def _sha256_file(path: Path) -> str:
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise SnapshotValidationError(f"snapshot file is not UTF-8 text: {path}") from exc
    canonical = text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def _digest(value: Any, field: str) -> str:
    if not isinstance(value, str) or len(value) != 71 or not value.startswith("sha256:"):
        raise SnapshotValidationError(f"{field} must be a SHA-256 digest")
    try:
        int(value[7:], 16)
    except ValueError as exc:
        raise SnapshotValidationError(f"{field} must be a SHA-256 digest") from exc
    return value


def load_snapshot_file_list(root: Path) -> tuple[str, ...]:
    path = Path(root) / "infra" / "stable" / "SNAPSHOT_FILES.txt"
    try:
        lines = tuple(line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    except OSError as exc:
        raise SnapshotValidationError(f"snapshot file list unreadable: {exc}") from exc
    files = tuple(line for line in lines if line and not line.startswith("#"))
    if not files or len(set(files)) != len(files):
        raise SnapshotValidationError("snapshot file list must be non-empty and unique")
    for raw in files:
        path_value = PurePosixPath(raw)
        if path_value.is_absolute() or "\\" in raw or ".." in path_value.parts:
            raise SnapshotValidationError(f"unsafe snapshot path: {raw}")
    return files


def generate_snapshot(
    root: Path,
    *,
    version: str,
    source_commit: str,
    target_base_commit: str,
    test_result: Mapping[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    root = Path(root).resolve()
    if set(test_result) != TEST_RESULT_FIELDS:
        raise SnapshotValidationError("test_result requires its exact field set")
    file_digests: dict[str, str] = {}
    for relative in load_snapshot_file_list(root):
        target = root / relative
        if not target.is_file() or target.is_symlink():
            raise SnapshotValidationError(f"snapshot file missing or unsafe: {relative}")
        file_digests[relative] = _sha256_file(target)
    manifest = load_manifest(root / "MANIFEST.yaml")
    payload = {
        "version": version,
        "commit": source_commit,
        "target_base_commit": target_base_commit,
        "manifest_digest": compute_manifest_digest(manifest),
        "file_digest_canonicalization": "utf8-lf",
        "file_digests": file_digests,
        "test_result": dict(test_result),
        "created_at": created_at
        or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    validate_snapshot_payload(payload, root)
    atomic_write_json(root / "infra" / "stable" / "SNAPSHOT.json", payload)
    return payload


def validate_snapshot_payload(value: Mapping[str, Any], root: Path) -> None:
    if not isinstance(value, dict) or set(value) != SNAPSHOT_FIELDS:
        raise SnapshotValidationError("snapshot requires its exact field set")
    for field in ("version", "commit", "target_base_commit", "created_at"):
        if not isinstance(value[field], str) or not value[field].strip():
            raise SnapshotValidationError(f"{field} must be a non-empty string")
    try:
        parsed = datetime.fromisoformat(value["created_at"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise SnapshotValidationError("created_at must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise SnapshotValidationError("created_at must include timezone")
    manifest_digest = _digest(value["manifest_digest"], "manifest_digest")
    if value["file_digest_canonicalization"] != "utf8-lf":
        raise SnapshotValidationError("file digest canonicalization must be utf8-lf")
    manifest = load_manifest(Path(root) / "MANIFEST.yaml")
    if manifest_digest != compute_manifest_digest(manifest):
        raise SnapshotValidationError("manifest digest mismatch")
    files = value["file_digests"]
    if not isinstance(files, dict) or tuple(files) != load_snapshot_file_list(root):
        raise SnapshotValidationError("file_digests order/set differs from SNAPSHOT_FILES.txt")
    for relative, expected in files.items():
        _digest(expected, f"file_digests.{relative}")
        target = Path(root) / relative
        if not target.is_file() or target.is_symlink() or _sha256_file(target) != expected:
            raise SnapshotValidationError(f"file digest mismatch: {relative}")
    result = value["test_result"]
    if not isinstance(result, dict) or set(result) != TEST_RESULT_FIELDS:
        raise SnapshotValidationError("test_result requires its exact field set")
    for field in ("methods", "pass", "fail", "blocked"):
        number = result[field]
        if isinstance(number, bool) or not isinstance(number, int) or number < 0:
            raise SnapshotValidationError(f"test_result.{field} must be non-negative integer")
    if result["methods"] != result["pass"] + result["fail"] + result["blocked"]:
        raise SnapshotValidationError("test_result totals are inconsistent")
    if not isinstance(result["command"], str) or not result["command"]:
        raise SnapshotValidationError("test_result.command is required")


def validate_snapshot(path: Path, root: Path | None = None) -> dict[str, Any]:
    path = Path(path)
    root = Path(root) if root is not None else path.resolve().parents[2]
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SnapshotValidationError(f"snapshot unreadable: {exc}") from exc
    validate_snapshot_payload(value, root)
    return value
