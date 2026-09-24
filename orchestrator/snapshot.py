"""Reproducible INFRA-STABLE snapshot and bundled source provenance validation."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from orchestrator.io_atomic import atomic_write_json, sha256_digest
from orchestrator.schemas.validate_manifest import compute_manifest_digest, load_manifest
from orchestrator.source_regression import verify_source_provenance


SNAPSHOT_FIELDS = frozenset(
    {
        "version",
        "source_repository",
        "source_commit",
        "source_tree",
        "promotion_commit",
        "target_base_commit",
        "manifest_digest",
        "snapshot_files",
        "snapshot_files_digest",
        "file_digest_canonicalization",
        "file_digests",
        "source_bundle_sha256",
        "regression_results",
        "created_at",
        "snapshot_digest",
    }
)
RESULT_FIELDS = frozenset({"methods", "pass", "fail", "blocked", "command"})
REGRESSION_RESULT_FIELDS = frozenset({"source", "shadow_and_remediation", "total"})


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


def _validate_result(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != RESULT_FIELDS:
        raise SnapshotValidationError(f"{field} requires its exact field set")
    for name in ("methods", "pass", "fail", "blocked"):
        number = value[name]
        if isinstance(number, bool) or not isinstance(number, int) or number < 0:
            raise SnapshotValidationError(f"{field}.{name} must be non-negative integer")
    if value["methods"] != value["pass"] + value["fail"] + value["blocked"]:
        raise SnapshotValidationError(f"{field} totals are inconsistent")
    if not isinstance(value["command"], str) or not value["command"]:
        raise SnapshotValidationError(f"{field}.command is required")
    return value


def _validate_regression_results(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != REGRESSION_RESULT_FIELDS:
        raise SnapshotValidationError("regression_results requires source, shadow_and_remediation and total")
    source = _validate_result(value["source"], "regression_results.source")
    shadow = _validate_result(value["shadow_and_remediation"], "regression_results.shadow_and_remediation")
    total = _validate_result(value["total"], "regression_results.total")
    for name in ("methods", "pass", "fail", "blocked"):
        if total[name] != source[name] + shadow[name]:
            raise SnapshotValidationError(f"regression_results.total.{name} is not derived")
    return value


def compute_snapshot_digest(payload: Mapping[str, Any]) -> str:
    canonical = dict(payload)
    canonical.pop("snapshot_digest", None)
    return sha256_digest(canonical)


def generate_snapshot(
    root: Path,
    *,
    version: str,
    target_base_commit: str,
    regression_results: Mapping[str, Any],
    created_at: str | None = None,
) -> dict[str, Any]:
    root = Path(root).resolve()
    source = verify_source_provenance(root)
    file_list = load_snapshot_file_list(root)
    file_digests: dict[str, str] = {}
    for relative in file_list:
        target = root / relative
        if not target.is_file() or target.is_symlink():
            raise SnapshotValidationError(f"snapshot file missing or unsafe: {relative}")
        file_digests[relative] = _sha256_file(target)
    manifest = load_manifest(root / "MANIFEST.yaml")
    payload = {
        "version": version,
        "source_repository": source["source_repository"],
        "source_commit": source["source_commit"],
        "source_tree": source["source_tree"],
        "promotion_commit": source["promotion_commit"],
        "target_base_commit": target_base_commit,
        "manifest_digest": compute_manifest_digest(manifest),
        "snapshot_files": "infra/stable/SNAPSHOT_FILES.txt",
        "snapshot_files_digest": _sha256_file(root / "infra" / "stable" / "SNAPSHOT_FILES.txt"),
        "file_digest_canonicalization": "utf8-lf",
        "file_digests": file_digests,
        "source_bundle_sha256": source["bundle_sha256"],
        "regression_results": dict(regression_results),
        "created_at": created_at
        or datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "snapshot_digest": "",
    }
    payload["snapshot_digest"] = compute_snapshot_digest(payload)
    validate_snapshot_payload(payload, root)
    atomic_write_json(root / "infra" / "stable" / "SNAPSHOT.json", payload)
    return payload


def validate_snapshot_payload(value: Mapping[str, Any], root: Path, *, verify_live_files: bool = True) -> None:
    if not isinstance(value, dict) or set(value) != SNAPSHOT_FIELDS:
        raise SnapshotValidationError("snapshot requires its exact field set")
    for field in (
        "version",
        "source_repository",
        "source_commit",
        "source_tree",
        "promotion_commit",
        "target_base_commit",
        "created_at",
    ):
        if not isinstance(value[field], str) or not value[field].strip():
            raise SnapshotValidationError(f"{field} must be a non-empty string")
    try:
        parsed = datetime.fromisoformat(value["created_at"].replace("Z", "+00:00"))
    except ValueError as exc:
        raise SnapshotValidationError("created_at must be ISO-8601") from exc
    if parsed.tzinfo is None:
        raise SnapshotValidationError("created_at must include timezone")
    source = verify_source_provenance(Path(root))
    for snapshot_field, source_field in (
        ("source_repository", "source_repository"),
        ("source_commit", "source_commit"),
        ("source_tree", "source_tree"),
        ("promotion_commit", "promotion_commit"),
        ("source_bundle_sha256", "bundle_sha256"),
    ):
        if value[snapshot_field] != source[source_field]:
            raise SnapshotValidationError(f"{snapshot_field} differs from verified source provenance")
    manifest_digest = _digest(value["manifest_digest"], "manifest_digest")
    if value["file_digest_canonicalization"] != "utf8-lf":
        raise SnapshotValidationError("file digest canonicalization must be utf8-lf")
    if value["snapshot_files"] != "infra/stable/SNAPSHOT_FILES.txt":
        raise SnapshotValidationError("snapshot_files must name the canonical list")
    if value["snapshot_files_digest"] != _sha256_file(Path(root) / value["snapshot_files"]):
        raise SnapshotValidationError("SNAPSHOT_FILES digest mismatch")
    manifest = load_manifest(Path(root) / "MANIFEST.yaml")
    if manifest_digest != compute_manifest_digest(manifest):
        raise SnapshotValidationError("manifest digest mismatch")
    files = value["file_digests"]
    if not isinstance(files, dict) or tuple(files) != load_snapshot_file_list(root):
        raise SnapshotValidationError("file_digests order/set differs from SNAPSHOT_FILES.txt")
    for relative, expected in files.items():
        _digest(expected, f"file_digests.{relative}")
        if verify_live_files:
            target = Path(root) / relative
            if not target.is_file() or target.is_symlink() or _sha256_file(target) != expected:
                raise SnapshotValidationError(f"file digest mismatch: {relative}")
    _validate_regression_results(value["regression_results"])
    _digest(value["source_bundle_sha256"], "source_bundle_sha256")
    _digest(value["snapshot_digest"], "snapshot_digest")
    observed = compute_snapshot_digest(value)
    if observed != value["snapshot_digest"]:
        raise SnapshotValidationError("snapshot digest mismatch")


def validate_snapshot(path: Path, root: Path | None = None, *, verify_live_files: bool = True) -> dict[str, Any]:
    path = Path(path)
    root = Path(root) if root is not None else path.resolve().parents[2]
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SnapshotValidationError(f"snapshot unreadable: {exc}") from exc
    validate_snapshot_payload(value, root, verify_live_files=verify_live_files)
    return value
