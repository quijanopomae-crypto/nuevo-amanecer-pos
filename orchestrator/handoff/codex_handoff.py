"""Generate an external, user-carried Codex escalation report; no API call."""

from __future__ import annotations

import json
from pathlib import Path

from orchestrator.evidence.pack import EvidencePack
from orchestrator.gates.codex_admission import CodexAdmissionResult, CodexDecision
from orchestrator.io_atomic import atomic_write_text


class CodexHandoffError(ValueError):
    pass


def _section(title: str, value: object) -> str:
    if isinstance(value, (dict, list, tuple)):
        rendered = json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True)
    else:
        rendered = str(value)
    return f"## {title}\n\n```text\n{rendered}\n```\n"


def write_codex_escalation_report(
    path: Path,
    *,
    evidence: EvidencePack,
    admission: CodexAdmissionResult,
    requested_codex_action: str,
) -> Path:
    evidence.validate()
    if admission.decision is not CodexDecision.ADMIT:
        raise CodexHandoffError("Codex handoff requires ADMIT")
    if not requested_codex_action:
        raise CodexHandoffError("requested Codex action is required")
    payload = evidence.payload
    markdown = "# CODEX_ESCALATION_REPORT\n\n"
    markdown += _section("run_id", payload["run_id"])
    markdown += _section("cycle_id", payload["cycle_id"])
    markdown += _section("task", {"task_id": payload["task_id"], "objective": payload["feature_spec"]["objective"]})
    markdown += _section("risk", payload["risk_class"])
    markdown += _section("failure", payload["failures"])
    markdown += _section("confirmed facts", payload["confirmed_facts"])
    markdown += _section("unknowns", payload["unknowns"])
    markdown += _section("attempt history", payload["state_history"])
    markdown += _section("tests", {"executed": payload["tests_executed"], "results": payload["results"]})
    markdown += _section("diff", payload["diff_patch"])
    markdown += _section("evidence digest", payload["evidence_digest"])
    markdown += _section("manifest digest", payload["manifest_digest"])
    markdown += _section("requested Codex action", requested_codex_action)
    markdown += _section("transport", "MANUAL_USER_HANDOFF_TO_CODEX_APP")
    target = Path(path)
    if target.name != "CODEX_ESCALATION_REPORT.md":
        raise CodexHandoffError("handoff filename must be CODEX_ESCALATION_REPORT.md")
    atomic_write_text(target, markdown)
    return target
