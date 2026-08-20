"""Static project-local contract validation for OpenCode shadow mode."""

from __future__ import annotations

import json
from pathlib import Path

from orchestrator.schemas.validate_manifest import validate_manifest_file
from orchestrator.snapshot import validate_snapshot


EXPECTED_AGENTS = frozenset({"planner", "implementer", "tester", "reviewer"})
EXPECTED_COMMANDS = frozenset({"preflight", "feature-spec", "orchestrate", "validate", "resume"})
EXPECTED_SKILLS = frozenset(
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
COMPARISON_DIMENSIONS = frozenset(
    {"scope", "risk", "preflight", "routing", "anti-loop", "failure_handling", "evidence", "resume_capability"}
)
COMPARISON_RATINGS = frozenset({"EQUIVALENT", "BETTER", "WORSE", "UNSUPPORTED"})


class ProjectValidationError(ValueError):
    pass


def _markdown_stems(path: Path) -> frozenset[str]:
    return frozenset(item.stem for item in path.glob("*.md") if item.is_file())


def validate_project(root: Path, *, require_snapshot: bool = True) -> dict[str, object]:
    root = Path(root).resolve()
    manifest = validate_manifest_file(root / "MANIFEST.yaml", root)
    agents = _markdown_stems(root / ".opencode" / "agents")
    commands = _markdown_stems(root / ".opencode" / "commands")
    skills_root = root / ".agents" / "skills"
    skills = frozenset(
        item.name for item in skills_root.iterdir() if item.is_dir() and (item / "SKILL.md").is_file()
    )
    if agents != EXPECTED_AGENTS:
        raise ProjectValidationError(f"agent set mismatch: {sorted(agents)}")
    if commands != EXPECTED_COMMANDS:
        raise ProjectValidationError(f"command set mismatch: {sorted(commands)}")
    if skills != EXPECTED_SKILLS:
        raise ProjectValidationError(f"skill set mismatch: {sorted(skills)}")
    if (root / ".opencode" / "skills").exists():
        raise ProjectValidationError(".opencode/skills is forbidden")
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
        "snapshot": snapshot["version"] if snapshot else "NOT_REQUIRED",
    }
