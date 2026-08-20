"""Minimal, strict and digest-verifiable Evidence Pack."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from orchestrator.io_atomic import atomic_write_json, sha256_digest


PACK_FIELDS = frozenset(
    {
        "schema",
        "run_id",
        "cycle_id",
        "task_id",
        "repo",
        "branch",
        "head",
        "worktree",
        "wip_fingerprint",
        "manifest_digest",
        "feature_spec",
        "risk_class",
        "impact_analysis",
        "dependency_map",
        "preflight",
        "resource_check",
        "state_history",
        "commands_executed",
        "tests_executed",
        "results",
        "changed_files",
        "diff_patch",
        "failures",
        "confirmed_facts",
        "discarded_hypotheses",
        "unknowns",
        "verdict",
        "residual_risks",
        "next_action",
        "evidence_digest",
    }
)


class EvidencePackError(ValueError):
    pass


def _digest(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.startswith("sha256:") or len(value) != 71:
        raise EvidencePackError(f"{field} must be a SHA-256 digest")
    try:
        int(value[7:], 16)
    except ValueError as exc:
        raise EvidencePackError(f"{field} must be a SHA-256 digest") from exc
    return value


def _strings(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        raise EvidencePackError(f"{field} must be a string list")
    return value


@dataclass(frozen=True)
class EvidencePack:
    payload: dict[str, Any]

    @classmethod
    def create(cls, **values: Any) -> "EvidencePack":
        payload = {"schema": "evidence-pack@1", **values, "evidence_digest": ""}
        payload["evidence_digest"] = cls.compute_digest(payload)
        pack = cls(payload)
        pack.validate()
        return pack

    @staticmethod
    def compute_digest(payload: Mapping[str, Any]) -> str:
        canonical = dict(payload)
        canonical.pop("evidence_digest", None)
        return sha256_digest(canonical)

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "EvidencePack":
        if not isinstance(value, dict):
            raise EvidencePackError("Evidence Pack must be an object")
        pack = cls(dict(value))
        pack.validate()
        return pack

    @classmethod
    def load(cls, path: Path) -> "EvidencePack":
        try:
            value = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise EvidencePackError(f"Evidence Pack unreadable: {exc}") from exc
        return cls.from_dict(value)

    def validate(self) -> None:
        value = self.payload
        if set(value) != PACK_FIELDS or value.get("schema") != "evidence-pack@1":
            raise EvidencePackError("Evidence Pack has unknown or missing fields")
        for field in (
            "run_id",
            "task_id",
            "repo",
            "branch",
            "head",
            "worktree",
            "risk_class",
            "verdict",
            "next_action",
        ):
            if not isinstance(value[field], str) or not value[field]:
                raise EvidencePackError(f"{field} must be a non-empty string")
        if isinstance(value["cycle_id"], bool) or not isinstance(value["cycle_id"], int) or value["cycle_id"] < 1:
            raise EvidencePackError("cycle_id must be positive")
        _digest(value["wip_fingerprint"], "wip_fingerprint")
        _digest(value["manifest_digest"], "manifest_digest")
        _digest(value["evidence_digest"], "evidence_digest")
        for field in (
            "feature_spec",
            "impact_analysis",
            "dependency_map",
            "preflight",
            "resource_check",
        ):
            if not isinstance(value[field], dict):
                raise EvidencePackError(f"{field} must be an object")
        for field in (
            "state_history",
            "results",
            "failures",
        ):
            if not isinstance(value[field], list) or any(not isinstance(item, dict) for item in value[field]):
                raise EvidencePackError(f"{field} must be an object list")
        for field in (
            "commands_executed",
            "tests_executed",
            "changed_files",
            "confirmed_facts",
            "discarded_hypotheses",
            "unknowns",
            "residual_risks",
        ):
            _strings(value[field], field)
        if value["diff_patch"] is not None and not isinstance(value["diff_patch"], str):
            raise EvidencePackError("diff_patch must be null or string")
        observed = self.compute_digest(value)
        if observed != value["evidence_digest"]:
            raise EvidencePackError("Evidence Pack digest mismatch")

    @property
    def digest(self) -> str:
        return self.payload["evidence_digest"]

    def to_dict(self) -> dict[str, Any]:
        return json.loads(json.dumps(self.payload, ensure_ascii=False))

    def write(self, path: Path) -> None:
        self.validate()
        atomic_write_json(Path(path), self.payload)
