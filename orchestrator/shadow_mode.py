"""One-shot shadow orchestration that never authorizes product writes."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from orchestrator.contracts import (
    DependencyMap,
    FeatureSpec,
    ImpactAnalysis,
    RiskClassifier,
    RiskLevel,
)
from orchestrator.evidence.pack import EvidencePack
from orchestrator.evidence.trust import sign_run_artifacts
from orchestrator.gates.codex_admission import (
    CodexAdmissionContext,
    CodexAdmissionGate,
    CodexDecision,
)
from orchestrator.handoff.codex_handoff import write_codex_escalation_report
from orchestrator.io_atomic import sha256_digest
from orchestrator.schemas.validate_manifest import compute_manifest_digest, validate_manifest
from orchestrator.snapshot import validate_snapshot
from orchestrator.state.durable_state import (
    DurableStateRecord,
    DurableStateStore,
    utc_now,
    validate_event_log,
)
from orchestrator.state.resource_check import (
    RESOURCE_NAMES,
    ProbeStatus,
    RealisticResourceCheck,
    ResourceMode,
    ResourceRequirement,
)
from orchestrator.state.state_machine import State


SCENARIO_FIELDS = frozenset(
    {
        "id",
        "title",
        "task_type",
        "objective",
        "in_scope",
        "out_of_scope",
        "acceptance_criteria",
        "invariants",
        "expected_files",
        "forbidden_files",
        "impact",
        "module",
        "depends_on",
        "preflight",
        "resource_overrides",
        "failure_code",
        "failure_class",
        "expected_risk",
        "expected_state",
        "next_action",
        "cosmetic",
    }
)
class ShadowModeError(ValueError):
    pass


class ProductWriteDenied(PermissionError):
    pass


@dataclass(frozen=True)
class GitIdentity:
    repo: str
    branch: str
    head: str
    worktree: str
    wip_fingerprint: str


@dataclass(frozen=True)
class ShadowScenario:
    payload: dict[str, Any]

    @property
    def scenario_id(self) -> str:
        return self.payload["id"]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ShadowScenario":
        if not isinstance(value, dict) or set(value) != SCENARIO_FIELDS:
            raise ShadowModeError("scenario has unknown or missing fields")
        for field in (
            "id",
            "title",
            "task_type",
            "objective",
            "module",
            "preflight",
            "expected_risk",
            "expected_state",
            "next_action",
        ):
            if not isinstance(value[field], str) or not value[field].strip():
                raise ShadowModeError(f"scenario.{field} is required")
        if type(value["cosmetic"]) is not bool:
            raise ShadowModeError("scenario.cosmetic must be boolean")
        for field in (
            "in_scope",
            "out_of_scope",
            "acceptance_criteria",
            "invariants",
            "expected_files",
            "forbidden_files",
            "depends_on",
        ):
            items = value[field]
            if not isinstance(items, list) or len(items) != len(set(items)) or any(
                not isinstance(item, str) or not item for item in items
            ):
                raise ShadowModeError(f"scenario.{field} must be a unique string list")
        if not isinstance(value["impact"], dict) or not isinstance(value["resource_overrides"], dict):
            raise ShadowModeError("scenario impact/resource_overrides must be objects")
        for field in ("failure_code", "failure_class"):
            if value[field] is not None and (not isinstance(value[field], str) or not value[field]):
                raise ShadowModeError(f"scenario.{field} must be null or string")
        return cls(dict(value))


@dataclass(frozen=True)
class ShadowRunResult:
    scenario_id: str
    state: State
    risk: RiskLevel
    next_action: str
    routing: dict[str, Any]
    evidence_path: Path
    state_path: Path
    handoff_path: Path | None
    attestation_path: Path
    signature_path: Path


def load_scenarios(path: Path) -> dict[str, ShadowScenario]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ShadowModeError(f"scenarios unreadable: {exc}") from exc
    if not isinstance(value, dict) or set(value) != {"schema", "scenarios"} or value["schema"] != "shadow-scenarios@1":
        raise ShadowModeError("invalid scenario document")
    if not isinstance(value["scenarios"], list):
        raise ShadowModeError("scenarios must be a list")
    scenarios = tuple(ShadowScenario.from_dict(item) for item in value["scenarios"])
    result = {scenario.scenario_id: scenario for scenario in scenarios}
    if len(result) != len(scenarios):
        raise ShadowModeError("duplicate scenario id")
    return result


def assert_shadow_write_allowed(root: Path, target: Path, manifest: Mapping[str, Any]) -> Path:
    root = Path(root).resolve()
    target = Path(target).resolve()
    try:
        relative = target.relative_to(root)
    except ValueError as exc:
        raise ProductWriteDenied("shadow writes outside project are denied") from exc
    policy = manifest["shadow_write_policy"]
    if policy["product_write"] != "DENIED":
        raise ProductWriteDenied("shadow manifest must deny product writes")
    if policy["writable_path_ref"] != "evidence" or manifest["paths"]["evidence"] != "evidence":
        raise ProductWriteDenied("shadow writable root must be the fixed evidence directory")
    writable = PurePosixPath("evidence")
    if not relative.parts or PurePosixPath(*relative.parts).parts[: len(writable.parts)] != writable.parts:
        raise ProductWriteDenied(f"PRODUCT_WRITE_DENIED: {relative.as_posix()}")
    return target


def _feature_spec(scenario: ShadowScenario) -> FeatureSpec:
    value = scenario.payload
    return FeatureSpec.from_dict(
        {
            "objective": value["objective"],
            "in_scope": value["in_scope"],
            "out_of_scope": value["out_of_scope"],
            "acceptance_criteria": value["acceptance_criteria"],
            "invariants": value["invariants"],
            "expected_files": value["expected_files"],
            "forbidden_files": value["forbidden_files"],
        }
    )


def _dependency_map(scenario: ShadowScenario, impact: ImpactAnalysis) -> DependencyMap:
    value = scenario.payload
    dependencies = list(value["depends_on"])
    modules = [
        {
            "module": value["module"],
            "depends_on": dependencies,
            "read_dependencies": list(impact.reads),
            "write_dependencies": list(impact.writes),
            "shared_globals": [],
            "storage": list(impact.storage_affected),
            "dom": list(impact.dom_affected),
            "tests": [value["task_type"]],
        }
    ]
    for dependency in dependencies:
        modules.append(
            {
                "module": dependency,
                "depends_on": [],
                "read_dependencies": [],
                "write_dependencies": [],
                "shared_globals": [],
                "storage": [],
                "dom": [],
                "tests": [],
            }
        )
    return DependencyMap.from_dict({"modules": modules})


def _resources(scenario: ShadowScenario) -> tuple[dict[str, Any], ResourceMode]:
    overrides = scenario.payload["resource_overrides"]
    probes: list[ResourceRequirement] = []
    for name in RESOURCE_NAMES:
        required = name not in {"browser", "ports"}
        status = ProbeStatus.READY if required else ProbeStatus.NOT_REQUIRED
        failure_class = None
        detail = "shadow:ready" if required else "shadow:not-required"
        if name in overrides:
            override = overrides[name]
            if not isinstance(override, dict) or set(override) != {"status", "failure_class"}:
                raise ShadowModeError(f"invalid resource override: {name}")
            status = ProbeStatus(override["status"])
            failure_class = override["failure_class"]
            detail = "shadow:declared-" + status.value.casefold()
        probes.append(ResourceRequirement(name, required, status, detail, failure_class))
    result = RealisticResourceCheck.evaluate(probes)
    return (
        {
            "mode": result.mode.value,
            "blockers": list(result.blockers),
            "degraded": list(result.degraded),
            "probes": [
                {
                    "name": item.name,
                    "required": item.required,
                    "status": item.status.value,
                    "detail": item.detail,
                    "failure_class": item.failure_class,
                }
                for item in result.probes
            ],
        },
        result.mode,
    )


def _render_model(manifest: Mapping[str, Any], model_ref: str) -> str:
    model = manifest["models"][model_ref]
    variant = model["variant"]
    return model["model_id"] if variant == "primary" else f"{model['model_id']}:{variant}"


def _routing(
    scenario: ShadowScenario,
    risk: RiskLevel,
    manifest: Mapping[str, Any],
) -> tuple[dict[str, Any], CodexDecision, tuple[str, ...]]:
    failure_class = scenario.payload["failure_class"]
    routing_policy = manifest["routing"]
    blocked = failure_class in frozenset(routing_policy["blocked_failure_classes"])
    if blocked:
        codex_decision = CodexDecision.DENY
        codex_reasons = (f"BLOCKED_{failure_class}",)
    else:
        admission = CodexAdmissionGate.decide(
            CodexAdmissionContext(
                risk=risk,
                failure_class=failure_class,
                topics=tuple(scenario.payload["in_scope"]),
                cosmetic=scenario.payload["cosmetic"],
            ),
            routing_policy["critical_reviewer"],
        )
        codex_decision = admission.decision
        codex_reasons = admission.reasons
    primary_ref = routing_policy["primary_implementer"]["model_ref"]
    second_policy = routing_policy["second_engineer"]
    critical_policy = routing_policy["critical_reviewer"]
    routing = {
        "primary": None if blocked else _render_model(manifest, primary_ref),
        "conditional_review": (
            _render_model(manifest, second_policy["model_ref"])
            if not blocked and risk.value in frozenset(second_policy["risks"])
            else None
        ),
        "codex": codex_decision.value,
        "critical_reviewer": (
            _render_model(manifest, critical_policy["model_ref"])
            if codex_decision is CodexDecision.ADMIT
            else None
        ),
        "codex_reasons": list(codex_reasons),
        "product_write": "DENIED",
    }
    return routing, codex_decision, codex_reasons


def _transition_for_scenario(
    store: DurableStateStore,
    scenario: ShadowScenario,
    resource_mode: ResourceMode,
    codex_decision: CodexDecision,
) -> State:
    value = scenario.payload
    store.transition(State.PREFLIGHT_RUNNING, next_action="complete preflight")
    if value["preflight"] == "WRONG_WORKTREE":
        store.transition(
            State.WRONG_WORKTREE,
            next_action=value["next_action"],
            failure_class=value["failure_class"],
        )
        return State.WRONG_WORKTREE
    store.transition(State.PREFLIGHT_PASSED, next_action="run Resource Check")
    store.transition(State.RESOURCE_CHECK, next_action="evaluate declared resources")
    if resource_mode is ResourceMode.RESOURCE_BLOCKED:
        store.transition(
            State.RESOURCE_BLOCKED,
            next_action=value["next_action"],
            failure_class=value["failure_class"],
        )
        return State.RESOURCE_BLOCKED
    store.transition(State.RESOURCE_READY, next_action="materialize scope")
    store.transition(State.SCOPED, next_action="apply shadow classification")
    if value["failure_code"] == "F6":
        store.transition(State.CONTRACT_READY, next_action="run synthetic harness")
        store.transition(State.TESTING, next_action="classify harness result")
        store.transition(
            State.HARNESS_BLOCKED,
            next_action=value["next_action"],
            failure_class=value["failure_class"],
        )
        return State.HARNESS_BLOCKED
    if value["failure_code"] == "F8":
        store.transition(State.INVESTIGATING, next_action="stop on unknown critical cause")
        store.transition(
            State.ESCALATED,
            next_action=value["next_action"],
            failure_class=value["failure_class"],
        )
        return State.ESCALATED
    if codex_decision is CodexDecision.ADMIT:
        store.transition(State.CONTRACT_READY, next_action="perform independent review")
        store.transition(State.REVIEWING, next_action="evaluate Codex admission")
        store.transition(State.READY_FOR_CODEX_REVIEW, next_action=value["next_action"])
        return State.READY_FOR_CODEX_REVIEW
    store.transition(State.READ_ONLY_COMPLETE, next_action=value["next_action"])
    return State.READ_ONLY_COMPLETE


class ShadowOrchestrator:
    def __init__(
        self,
        root: Path,
        manifest: Mapping[str, Any],
        identity: GitIdentity,
        *,
        signing_key: Path,
        snapshot_digest: str,
    ) -> None:
        self.root = Path(root).resolve()
        self.manifest = dict(manifest)
        validate_manifest(self.manifest, self.root)
        self.manifest_digest = compute_manifest_digest(self.manifest)
        self.identity = identity
        self.signing_key = Path(signing_key)
        verified_snapshot = validate_snapshot(
            self.root / "infra" / "stable" / "SNAPSHOT.json",
            self.root,
        )
        if snapshot_digest != verified_snapshot["snapshot_digest"]:
            raise ShadowModeError("snapshot digest is not the validated INFRA-STABLE digest")
        self.snapshot_digest = verified_snapshot["snapshot_digest"]

    def run(self, scenario: ShadowScenario, output_root: Path, *, run_id: str) -> ShadowRunResult:
        output_root = assert_shadow_write_allowed(self.root, output_root, self.manifest)
        run_dir = assert_shadow_write_allowed(self.root, output_root / run_id, self.manifest)
        if run_dir.exists():
            raise ShadowModeError(f"run directory already exists: {run_dir}")
        spec = _feature_spec(scenario)
        impact = ImpactAnalysis.from_dict(scenario.payload["impact"])
        dependency = _dependency_map(scenario, impact)
        risk = RiskClassifier.classify(spec, impact).level
        if risk.value != scenario.payload["expected_risk"]:
            raise ShadowModeError(
                f"risk mismatch for {scenario.scenario_id}: {risk.value} != {scenario.payload['expected_risk']}"
            )
        resource_check, resource_mode = _resources(scenario)
        routing, codex_decision, codex_reasons = _routing(scenario, risk, self.manifest)
        evidence_seed = sha256_digest(
            {"scenario": scenario.payload, "routing": routing, "resources": resource_check}
        )
        state_root = run_dir / "state"
        store = DurableStateStore(state_root)
        initial = DurableStateRecord(
            run_id=run_id,
            cycle_id=1,
            task_id=scenario.scenario_id,
            state=State.RECEIVED,
            previous_state=None,
            timestamp=utc_now(),
            model=routing["primary"] or "none",
            attempt=0,
            risk=risk.value,
            failure_class=None,
            repo=self.identity.repo,
            branch=self.identity.branch,
            head=self.identity.head,
            worktree=self.identity.worktree,
            wip_fingerprint=self.identity.wip_fingerprint,
            manifest_digest=self.manifest_digest,
            evidence_digest=evidence_seed,
            next_action="run preflight",
        )
        store.initialize(initial)
        final_state = _transition_for_scenario(store, scenario, resource_mode, codex_decision)
        if final_state.value != scenario.payload["expected_state"]:
            raise ShadowModeError(
                f"state mismatch for {scenario.scenario_id}: {final_state.value} != {scenario.payload['expected_state']}"
            )
        events = validate_event_log(store.log_path)
        failure = []
        if scenario.payload["failure_code"]:
            failure.append(
                {
                    "code": scenario.payload["failure_code"],
                    "classification": scenario.payload["failure_class"],
                    "state": final_state.value,
                }
            )
        pack = EvidencePack.create(
            run_id=run_id,
            cycle_id=1,
            task_id=scenario.scenario_id,
            repo=self.identity.repo,
            branch=self.identity.branch,
            head=self.identity.head,
            worktree=self.identity.worktree,
            wip_fingerprint=self.identity.wip_fingerprint,
            manifest_digest=self.manifest_digest,
            feature_spec=spec.to_dict(),
            risk_class=risk.value,
            impact_analysis=impact.to_dict(),
            dependency_map=dependency.to_dict(),
            preflight={
                "result": scenario.payload["preflight"],
                "head": self.identity.head,
                "branch": self.identity.branch,
                "worktree": self.identity.worktree,
                "product_write": "DENIED",
            },
            resource_check=resource_check,
            state_history=[event.to_dict() for event in events],
            commands_executed=[f"shadow-run:{scenario.scenario_id}"],
            tests_executed=["synthetic harness"] if scenario.payload["task_type"] == "TEST" else [],
            results=[
                {
                    "state": final_state.value,
                    "risk": risk.value,
                    "routing": routing,
                    "next_action": scenario.payload["next_action"],
                }
            ],
            changed_files=[],
            diff_patch=None,
            failures=failure,
            confirmed_facts=["PRODUCT_WRITE = DENIED", "shadow mode only"],
            discarded_hypotheses=[],
            unknowns=["root cause"] if scenario.payload["failure_code"] == "F8" else [],
            verdict=final_state.value,
            residual_risks=list(codex_reasons),
            next_action=scenario.payload["next_action"],
        )
        evidence_path = run_dir / "EVIDENCE_PACK.json"
        pack.write(evidence_path)
        attestation_path, signature_path = sign_run_artifacts(
            self.root,
            run_dir,
            self.signing_key,
            self.snapshot_digest,
        )
        handoff_path = None
        if codex_decision is CodexDecision.ADMIT:
            handoff_path = run_dir / "CODEX_ESCALATION_REPORT.md"
            write_codex_escalation_report(
                handoff_path,
                evidence=pack,
                admission=CodexAdmissionGate.decide(
                    CodexAdmissionContext(
                        risk=risk,
                        failure_class=scenario.payload["failure_class"],
                        topics=tuple(scenario.payload["in_scope"]),
                        cosmetic=scenario.payload["cosmetic"],
                    ),
                    self.manifest["routing"]["critical_reviewer"],
                ),
                requested_codex_action="independent shadow evidence review",
            )
        return ShadowRunResult(
            scenario.scenario_id,
            final_state,
            risk,
            scenario.payload["next_action"],
            routing,
            evidence_path,
            store.state_path,
            handoff_path,
            attestation_path,
            signature_path,
        )
