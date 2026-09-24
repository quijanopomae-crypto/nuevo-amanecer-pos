"""Static validation for the live OpenCode surface plus optional legacy shadow baseline."""

from __future__ import annotations

import json
from pathlib import Path

from orchestrator.schemas.validate_manifest import validate_manifest_file
from orchestrator.snapshot import validate_snapshot


SHADOW_COMMANDS = frozenset({"preflight", "feature-spec", "orchestrate", "validate", "resume"})
SHADOW_SKILLS = frozenset(
    {
        "feature-spec",
        "impact-analysis",
        "dependency-map",
        "inventory-integrity",
        "cash-integrity",
        "credits-integrity",
        "cross-module-impact",
        "evidence-pack",
        "release-readiness",
    }
)
CURRENT_AGENTS = frozenset(
    {
        "pos-canon-implementer",
        "pos-lab-implementer",
        "pos-implementer",
        "pos-planner",
        "pos-reviewer",
        "pos-tester",
    }
)
CURRENT_COMMANDS = SHADOW_COMMANDS | frozenset(
    {"lab-preflight", "lab-validate", "canon-preflight", "canon-validate"}
)
CURRENT_SKILLS = SHADOW_SKILLS | frozenset(
    {"canon-promotion", "lab-animation-edit", "lab-feature-edit", "lab-scope-guard", "lab-ui-edit"}
)

# Backward-compatible exports used by the existing infrastructure tests.
EXPECTED_COMMANDS = CURRENT_COMMANDS
EXPECTED_SKILLS = CURRENT_SKILLS
COMPARISON_DIMENSIONS = frozenset(
    {"scope", "risk", "preflight", "routing", "anti-loop", "failure_handling", "evidence", "resume_capability"}
)
COMPARISON_RATINGS = frozenset({"EQUIVALENT", "BETTER", "WORSE", "UNSUPPORTED"})


class ProjectValidationError(ValueError):
    pass


def _markdown_stems(path: Path) -> frozenset[str]:
    return frozenset(item.stem for item in path.glob("*.md") if item.is_file())


def validate_project(root: Path, *, require_snapshot: bool = False) -> dict[str, object]:
    root = Path(root).resolve()
    manifest = validate_manifest_file(root / "MANIFEST.yaml", root)
    agents = _markdown_stems(root / ".opencode" / "agents")
    shadow_agents = frozenset(role["runtime_agent_id"] for role in manifest["roles"].values())
    commands = _markdown_stems(root / ".opencode" / "commands")
    skills_root = root / ".agents" / "skills"
    skills = frozenset(
        item.name for item in skills_root.iterdir() if item.is_dir() and (item / "SKILL.md").is_file()
    )
    if shadow_agents - CURRENT_AGENTS:
        raise ProjectValidationError(f"shadow manifest references unknown live agents: {sorted(shadow_agents - CURRENT_AGENTS)}")
    if agents != CURRENT_AGENTS:
        raise ProjectValidationError(f"agent set mismatch: {sorted(agents)}")
    if commands != CURRENT_COMMANDS:
        raise ProjectValidationError(f"command set mismatch: {sorted(commands)}")
    if skills != CURRENT_SKILLS:
        raise ProjectValidationError(f"skill set mismatch: {sorted(skills)}")
    if frozenset(manifest["skills"]["required"]) != SHADOW_SKILLS:
        raise ProjectValidationError("legacy shadow skill set drifted from MANIFEST")
    if (root / ".opencode" / "skills").exists():
        raise ProjectValidationError(".opencode/skills is forbidden")
    if "tools" in manifest["paths"] or (root / ".opencode" / "tools").exists():
        raise ProjectValidationError("undeclared or fictitious .opencode/tools is forbidden")
    try:
        config = json.loads((root / "opencode.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProjectValidationError(f"opencode.json unreadable: {exc}") from exc
    instructions = config.get("instructions")
    if not isinstance(instructions, list) or "AGENTS_Nuevo_Amanecer.md" not in instructions:
        raise ProjectValidationError("INFRA V2 fallback instruction is not preserved")
    comparison_path = root / "infra" / "stable" / "INFRA_V2_COMPARISON.json"
    try:
        comparison = json.loads(comparison_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProjectValidationError(f"comparison unreadable: {exc}") from exc
    dimensions = comparison.get("dimensions")
    if not isinstance(dimensions, dict) or set(dimensions) != COMPARISON_DIMENSIONS:
        raise ProjectValidationError("comparison dimensions mismatch")
    for name, item in dimensions.items():
        if not isinstance(item, dict) or set(item) != {"rating", "reason"}:
            raise ProjectValidationError(f"invalid comparison entry: {name}")
        if item["rating"] not in COMPARISON_RATINGS or not isinstance(item["reason"], str) or not item["reason"]:
            raise ProjectValidationError(f"invalid comparison rating: {name}")
    snapshot = None
    if require_snapshot:
        snapshot = validate_snapshot(root / "infra" / "stable" / "SNAPSHOT.json", root)
    return {
        "manifest": manifest["schema"],
        "agents": sorted(agents),
        "commands": sorted(commands),
        "skills": sorted(skills),
        "v2_fallback": True,
        "snapshot": snapshot["version"] if snapshot else "HISTORICAL_BASELINE_NOT_APPLIED",
    }
