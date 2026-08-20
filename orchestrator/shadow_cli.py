#!/usr/bin/env python3
"""One-shot command line for project-local shadow mode."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator.project_validation import validate_project
from orchestrator.schemas.validate_manifest import compute_manifest_digest, load_manifest
from orchestrator.shadow_mode import (
    GitIdentity,
    ShadowOrchestrator,
    assert_shadow_write_allowed,
    load_scenarios,
)
from orchestrator.snapshot import generate_snapshot
from orchestrator.state.durable_state import (
    DurableStateRecord,
    DurableStateStore,
    RecoveryStatus,
    SimulatedCrash,
    utc_now,
)
from orchestrator.state.state_machine import State


ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ROOT / "fixtures" / "shadow" / "scenarios.json"


def _git(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return completed.stdout.strip()


def git_identity() -> GitIdentity:
    status = _git("status", "--porcelain=v1", "--untracked-files=all")
    fingerprint = "sha256:" + hashlib.sha256(status.encode("utf-8")).hexdigest()
    return GitIdentity(
        repo=str(ROOT),
        branch=_git("branch", "--show-current"),
        head=_git("rev-parse", "HEAD"),
        worktree=str(ROOT),
        wip_fingerprint=fingerprint,
    )


def manifest_digest() -> str:
    return compute_manifest_digest(load_manifest(ROOT / "MANIFEST.yaml"))


def command_validate_project(_: argparse.Namespace) -> int:
    print(json.dumps(validate_project(ROOT), ensure_ascii=False, sort_keys=True))
    return 0


def command_run_scenario(args: argparse.Namespace) -> int:
    scenarios = load_scenarios(SCENARIOS)
    if args.scenario_id not in scenarios:
        raise SystemExit(f"unknown scenario: {args.scenario_id}")
    output_root = Path(args.output_root)
    if not output_root.is_absolute():
        output_root = ROOT / output_root
    runner = ShadowOrchestrator(ROOT, manifest_digest(), git_identity())
    result = runner.run(scenarios[args.scenario_id], output_root, run_id=args.run_id or args.scenario_id)
    print(
        json.dumps(
            {
                "scenario": result.scenario_id,
                "state": result.state.value,
                "risk": result.risk.value,
                "next_action": result.next_action,
                "routing": result.routing,
                "evidence": str(result.evidence_path),
                "handoff": str(result.handoff_path) if result.handoff_path else None,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0


def command_run_all(args: argparse.Namespace) -> int:
    scenarios = load_scenarios(SCENARIOS)
    output_root = Path(args.output_root)
    if not output_root.is_absolute():
        output_root = ROOT / output_root
    runner = ShadowOrchestrator(ROOT, manifest_digest(), git_identity())
    results = []
    for scenario_id, scenario in scenarios.items():
        result = runner.run(scenario, output_root, run_id=scenario_id)
        results.append({"scenario": scenario_id, "state": result.state.value, "risk": result.risk.value})
    print(json.dumps(results, ensure_ascii=False, sort_keys=True))
    return 0


def _resume_initial(state_root: Path) -> DurableStateRecord:
    identity = git_identity()
    seed = "sha256:" + hashlib.sha256(b"resume-demo").hexdigest()
    return DurableStateRecord(
        run_id="resume-demo",
        cycle_id=1,
        task_id="resume-after-preflight",
        state=State.RECEIVED,
        previous_state=None,
        timestamp=utc_now(),
        model="deepseek/deepseek-v4-pro",
        attempt=0,
        risk="LOW",
        failure_class=None,
        repo=identity.repo,
        branch=identity.branch,
        head=identity.head,
        worktree=identity.worktree,
        wip_fingerprint=identity.wip_fingerprint,
        manifest_digest=manifest_digest(),
        evidence_digest=seed,
        next_action="run preflight",
    )


def _state_root(raw: str) -> Path:
    value = Path(raw)
    if not value.is_absolute():
        value = ROOT / value
    return assert_shadow_write_allowed(ROOT, value)


def command_resume_start(args: argparse.Namespace) -> int:
    state_root = _state_root(args.state_root)
    store = DurableStateStore(state_root)
    store.initialize(_resume_initial(state_root))
    store.transition(State.PREFLIGHT_RUNNING, next_action="complete preflight")
    try:
        store.transition(
            State.PREFLIGHT_PASSED,
            next_action="run Resource Check",
            simulate_crash_after_log=True,
        )
    except SimulatedCrash:
        print(json.dumps({"status": "SIMULATED_CRASH", "next_action": "run Resource Check"}))
        return 75
    return 1


def command_resume(args: argparse.Namespace) -> int:
    store = DurableStateStore(_state_root(args.state_root))
    result = store.recover(repair=True)
    print(
        json.dumps(
            {
                "status": result.status.value,
                "state": result.record.state.value if result.record else None,
                "next_action": result.record.next_action if result.record else None,
                "reason": result.reason,
            },
            ensure_ascii=False,
            sort_keys=True,
        )
    )
    return 0 if result.status is RecoveryStatus.RECOVERABLE else 2


def command_generate_snapshot(args: argparse.Namespace) -> int:
    result = generate_snapshot(
        ROOT,
        version="1.0.0-shadow.1",
        source_commit="93c7bd73a6553b3aede655eea1204861264dfc22",
        target_base_commit="28b90db0308a1bdddd3024374d7461aa22acc520",
        test_result={
            "methods": args.methods,
            "pass": args.passed,
            "fail": args.failed,
            "blocked": args.blocked,
            "command": 'python -B -m unittest discover -s tests/infrastructure -p "test_*.py" -v',
        },
        created_at=args.created_at,
    )
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    subcommands = result.add_subparsers(dest="command", required=True)
    validate = subcommands.add_parser("validate-project")
    validate.set_defaults(handler=command_validate_project)
    run = subcommands.add_parser("run-scenario")
    run.add_argument("scenario_id")
    run.add_argument("--output-root", default="evidence/shadow")
    run.add_argument("--run-id")
    run.set_defaults(handler=command_run_scenario)
    run_all = subcommands.add_parser("run-all")
    run_all.add_argument("--output-root", default="evidence/shadow")
    run_all.set_defaults(handler=command_run_all)
    resume_start = subcommands.add_parser("resume-start")
    resume_start.add_argument("state_root")
    resume_start.set_defaults(handler=command_resume_start)
    resume = subcommands.add_parser("resume")
    resume.add_argument("state_root")
    resume.set_defaults(handler=command_resume)
    snapshot = subcommands.add_parser("generate-snapshot")
    snapshot.add_argument("--methods", type=int, required=True)
    snapshot.add_argument("--passed", type=int, required=True)
    snapshot.add_argument("--failed", type=int, default=0)
    snapshot.add_argument("--blocked", type=int, default=0)
    snapshot.add_argument("--created-at")
    snapshot.set_defaults(handler=command_generate_snapshot)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
