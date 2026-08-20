"""Detached OpenSSH SSHSIG trust anchor for complete shadow run artifacts."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any, Mapping

from orchestrator.evidence.pack import EvidencePack, EvidencePackError
from orchestrator.io_atomic import atomic_write_json, canonical_json_bytes
from orchestrator.state.durable_state import DurableStateCorruption, StateSnapshot, validate_event_log


SIGNER_IDENTITY = "nuevo-amanecer-pos-shadow"
SIGNATURE_NAMESPACE = "nuevo-amanecer-evidence-v1"
ATTESTATION_FIELDS = frozenset(
    {
        "schema",
        "run_id",
        "cycle_id",
        "task_id",
        "repo",
        "branch",
        "head",
        "manifest_digest",
        "evidence_pack_sha256",
        "state_sha256",
        "event_log_sha256",
        "event_count",
        "event_tail_digest",
        "snapshot_digest",
    }
)


class TrustVerificationError(ValueError):
    pass


def _sha256_bytes(payload: bytes) -> str:
    return "sha256:" + hashlib.sha256(payload).hexdigest()


def _read_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TrustVerificationError(f"{label} unreadable: {exc}") from exc
    if not isinstance(value, dict):
        raise TrustVerificationError(f"{label} must be an object")
    return value


def _validated_run(run_dir: Path) -> tuple[EvidencePack, StateSnapshot, tuple[Any, ...]]:
    run_dir = Path(run_dir)
    pack_path = run_dir / "EVIDENCE_PACK.json"
    state_path = run_dir / "state" / "STATE.json"
    log_path = run_dir / "state" / "events.jsonl"
    try:
        pack = EvidencePack.from_dict(_read_json(pack_path, "Evidence Pack"))
        snapshot = StateSnapshot.from_dict(_read_json(state_path, "STATE"))
        events = validate_event_log(log_path)
    except (EvidencePackError, DurableStateCorruption, ValueError) as exc:
        raise TrustVerificationError(str(exc)) from exc
    if not events:
        raise TrustVerificationError("event log is empty")
    latest = events[-1]
    if snapshot.event_sequence != latest.sequence or snapshot.event_digest != latest.digest:
        raise TrustVerificationError("STATE does not anchor the event-log tail")
    if snapshot.record != latest.record:
        raise TrustVerificationError("STATE record differs from the event-log tail")
    if pack.payload["state_history"] != [event.to_dict() for event in events]:
        raise TrustVerificationError("Evidence Pack state_history differs from event log")
    identity = (
        pack.payload["run_id"],
        pack.payload["cycle_id"],
        pack.payload["task_id"],
        pack.payload["repo"],
        pack.payload["branch"],
        pack.payload["head"],
        pack.payload["manifest_digest"],
    )
    record_identity = (
        latest.record.run_id,
        latest.record.cycle_id,
        latest.record.task_id,
        latest.record.repo,
        latest.record.branch,
        latest.record.head,
        latest.record.manifest_digest,
    )
    if identity != record_identity:
        raise TrustVerificationError("Evidence Pack identity differs from durable state")
    return pack, snapshot, events


def build_attestation(run_dir: Path, snapshot_digest: str) -> dict[str, Any]:
    run_dir = Path(run_dir)
    pack, _, events = _validated_run(run_dir)
    if not isinstance(snapshot_digest, str) or not snapshot_digest.startswith("sha256:"):
        raise TrustVerificationError("snapshot_digest is required")
    payload = pack.payload
    return {
        "schema": "shadow-run-attestation@1",
        "run_id": payload["run_id"],
        "cycle_id": payload["cycle_id"],
        "task_id": payload["task_id"],
        "repo": payload["repo"],
        "branch": payload["branch"],
        "head": payload["head"],
        "manifest_digest": payload["manifest_digest"],
        "evidence_pack_sha256": _sha256_bytes((run_dir / "EVIDENCE_PACK.json").read_bytes()),
        "state_sha256": _sha256_bytes((run_dir / "state" / "STATE.json").read_bytes()),
        "event_log_sha256": _sha256_bytes((run_dir / "state" / "events.jsonl").read_bytes()),
        "event_count": len(events),
        "event_tail_digest": events[-1].digest,
        "snapshot_digest": snapshot_digest,
    }


def sign_run_artifacts(
    repository_root: Path,
    run_dir: Path,
    private_key: Path,
    snapshot_digest: str,
) -> tuple[Path, Path]:
    repository_root = Path(repository_root).resolve()
    run_dir = Path(run_dir)
    private_key = Path(private_key).resolve()
    if not private_key.is_file() or private_key.is_symlink():
        raise TrustVerificationError("external Ed25519 private key is unavailable")
    try:
        private_key.relative_to(repository_root)
    except ValueError:
        pass
    else:
        raise TrustVerificationError("private signing key must be outside the repository")
    attestation_path = run_dir / "RUN_ATTESTATION.json"
    signature_path = Path(str(attestation_path) + ".sig")
    if signature_path.exists():
        raise TrustVerificationError("detached signature already exists")
    atomic_write_json(attestation_path, build_attestation(run_dir, snapshot_digest))
    completed = subprocess.run(
        [
            "ssh-keygen",
            "-Y",
            "sign",
            "-f",
            str(private_key),
            "-n",
            SIGNATURE_NAMESPACE,
            str(attestation_path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0 or not signature_path.is_file():
        raise TrustVerificationError(f"SSHSIG signing failed: {completed.stderr.strip()}")
    return attestation_path, signature_path


def _verify_run_artifacts_with_anchor(
    run_dir: Path,
    allowed_signers: Path,
    *,
    expected_snapshot_digest: str,
) -> EvidencePack:
    run_dir = Path(run_dir)
    allowed_signers = Path(allowed_signers)
    attestation_path = run_dir / "RUN_ATTESTATION.json"
    signature_path = Path(str(attestation_path) + ".sig")
    if not allowed_signers.is_file() or allowed_signers.is_symlink():
        raise TrustVerificationError("pinned allowed_signers is unavailable")
    try:
        allowed_text = allowed_signers.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise TrustVerificationError(f"allowed_signers unreadable: {exc}") from exc
    if SIGNER_IDENTITY not in allowed_text or "ssh-ed25519 " not in allowed_text:
        raise TrustVerificationError("pinned signer must be an Ed25519 SSH key")
    attestation = _read_json(attestation_path, "run attestation")
    if set(attestation) != ATTESTATION_FIELDS or attestation.get("schema") != "shadow-run-attestation@1":
        raise TrustVerificationError("run attestation has unknown or missing fields")
    observed = build_attestation(run_dir, expected_snapshot_digest)
    if attestation != observed:
        raise TrustVerificationError("run attestation does not match current artifacts")
    if attestation["snapshot_digest"] != expected_snapshot_digest:
        raise TrustVerificationError("snapshot provenance digest mismatch")
    if not signature_path.is_file() or signature_path.is_symlink():
        raise TrustVerificationError("detached SSHSIG signature is unavailable")
    completed = subprocess.run(
        [
            "ssh-keygen",
            "-Y",
            "verify",
            "-f",
            str(allowed_signers),
            "-I",
            SIGNER_IDENTITY,
            "-n",
            SIGNATURE_NAMESPACE,
            "-s",
            str(signature_path),
        ],
        input=canonical_json_bytes(attestation) + b"\n",
        capture_output=True,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise TrustVerificationError(f"detached SSHSIG verification failed: {detail}")
    return _validated_run(run_dir)[0]


def verify_run_artifacts(repository_root: Path, run_dir: Path) -> EvidencePack:
    """Production verifier with trust inputs fixed and validated under INFRA-STABLE."""
    repository_root = Path(repository_root).resolve()
    run_dir = Path(run_dir).resolve()
    try:
        run_dir.relative_to(repository_root / "evidence")
    except ValueError as exc:
        raise TrustVerificationError("trusted run must live below repository evidence") from exc
    allowed_signers = repository_root / "infra" / "stable" / "trust" / "evidence_allowed_signers"
    if allowed_signers.is_symlink():
        raise TrustVerificationError("pinned allowed_signers cannot be a symlink")
    from orchestrator.snapshot import validate_snapshot

    snapshot = validate_snapshot(repository_root / "infra" / "stable" / "SNAPSHOT.json", repository_root)
    return _verify_run_artifacts_with_anchor(
        run_dir,
        allowed_signers,
        expected_snapshot_digest=snapshot["snapshot_digest"],
    )
