"""Synthetic-only Resource Check adapter for INFRA-LAB Phase 2."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Mapping

from .anti_loop import AntiLoopGuard, CycleDecision, CycleOutcome, CycleRecord
from .failure_taxonomy import FailureCode, FailureRecord, FailureTaxonomy
from .state_machine import State, StateMachine


RESOURCE_NAMES = (
    "selected_model",
    "provider_auth",
    "context_budget",
    "disk_space",
    "evidence_store",
    "writer_lease",
    "test_runtime",
    "browser",
    "ports",
)


class ResourceAdapterError(Exception):
    pass


@dataclass(frozen=True)
class ResourceProbe:
    name: str
    available: bool
    detail: str


@dataclass(frozen=True)
class ResourceCheckResult:
    state: State
    probes: tuple[ResourceProbe, ...]
    failure: FailureRecord | None
    corrective_attempts_consumed: int = 0
    cycle_decision: CycleDecision | None = None


class SyntheticResourceAdapter:
    """Returns declared booleans and performs no provider, browser or port call."""

    def __init__(self, availability: Mapping[str, bool]) -> None:
        supplied = set(availability)
        expected = set(RESOURCE_NAMES)
        if supplied != expected:
            missing = sorted(expected - supplied)
            unknown = sorted(supplied - expected)
            raise ResourceAdapterError(f"resource keys mismatch; missing={missing}, unknown={unknown}")
        if any(type(value) is not bool for value in availability.values()):
            raise ResourceAdapterError("synthetic resource values must be booleans")
        self._availability = dict(availability)

    @classmethod
    def all_available(cls) -> "SyntheticResourceAdapter":
        return cls({name: True for name in RESOURCE_NAMES})

    def probe(self, name: str) -> ResourceProbe:
        if name not in RESOURCE_NAMES:
            raise ResourceAdapterError(f"unknown resource: {name}")
        available = self._availability[name]
        return ResourceProbe(
            name=name,
            available=available,
            detail="synthetic:available" if available else "synthetic:unavailable",
        )

    def run(
        self,
        machine: StateMachine,
        taxonomy: FailureTaxonomy,
        *,
        anti_loop: AntiLoopGuard | None = None,
        cycle: CycleRecord | None = None,
    ) -> ResourceCheckResult:
        if machine.current is not State.RESOURCE_CHECK:
            raise ResourceAdapterError(f"Resource Check requires RESOURCE_CHECK, observed {machine.current.value}")
        if (anti_loop is None) is not (cycle is None):
            raise ResourceAdapterError("anti_loop and cycle must be supplied together")
        probes = tuple(self.probe(name) for name in RESOURCE_NAMES)
        unavailable = tuple(probe.name for probe in probes if not probe.available)
        if not unavailable:
            machine.transition(State.RESOURCE_READY, reason="synthetic resources available")
            return ResourceCheckResult(State.RESOURCE_READY, probes, None)

        failure = taxonomy.create_failure(
            run_id=machine.history[0].run_id,
            cycle_id=machine.history[0].cycle_id,
            code=FailureCode.F4,
            subcode="unavailable:" + ",".join(unavailable),
            detected_in_state=State.RESOURCE_CHECK,
            description="synthetic Resource Check reported unavailable resources",
            evidence_refs=tuple(f"synthetic-resource:{name}" for name in unavailable),
        )
        machine.transition(failure.transition, reason=failure.failure_id)
        cycle_decision = (
            anti_loop.finish_cycle(cycle, CycleOutcome.RESOURCE_BLOCKED)
            if anti_loop is not None and cycle is not None
            else None
        )
        return ResourceCheckResult(
            State.RESOURCE_BLOCKED,
            probes,
            failure,
            cycle_decision=cycle_decision,
        )


class ResourceMode(str, Enum):
    READY = "READY"
    DEGRADED = "DEGRADED"
    RESOURCE_BLOCKED = "RESOURCE_BLOCKED"


class ProbeStatus(str, Enum):
    READY = "READY"
    DEGRADED = "DEGRADED"
    UNAVAILABLE = "UNAVAILABLE"
    NOT_REQUIRED = "NOT_REQUIRED"


NON_MODEL_FAILURES = frozenset(
    {"RESOURCE_LIMIT", "PROVIDER_FAILURE", "EXTERNAL_DEPENDENCY", "TOOL_FAILURE"}
)


@dataclass(frozen=True)
class ResourceRequirement:
    name: str
    required: bool
    status: ProbeStatus
    detail: str
    failure_class: str | None = None

    def __post_init__(self) -> None:
        if self.name not in RESOURCE_NAMES:
            raise ResourceAdapterError(f"unknown resource: {self.name}")
        if not self.detail:
            raise ResourceAdapterError("resource detail is required")
        if self.failure_class is not None and self.failure_class not in NON_MODEL_FAILURES:
            raise ResourceAdapterError("resource failures cannot be classified as model failures")
        if self.status is ProbeStatus.UNAVAILABLE and self.failure_class is None:
            raise ResourceAdapterError("unavailable resource requires failure_class")
        if self.status is ProbeStatus.NOT_REQUIRED and self.required:
            raise ResourceAdapterError("required resource cannot be NOT_REQUIRED")


@dataclass(frozen=True)
class RealisticResourceResult:
    mode: ResourceMode
    probes: tuple[ResourceRequirement, ...]
    blockers: tuple[str, ...]
    degraded: tuple[str, ...]


class RealisticResourceCheck:
    """Evaluates declared one-shot probes without hard-coding host RAM or starting services."""

    @staticmethod
    def evaluate(probes: Iterable[ResourceRequirement]) -> RealisticResourceResult:
        declared = tuple(probes)
        names = [probe.name for probe in declared]
        if len(set(names)) != len(names):
            raise ResourceAdapterError("duplicate resource probe")
        if set(names) != set(RESOURCE_NAMES):
            raise ResourceAdapterError(
                f"resource keys mismatch; missing={sorted(set(RESOURCE_NAMES) - set(names))}"
            )
        blockers = tuple(
            probe.name
            for probe in declared
            if probe.required and probe.status is ProbeStatus.UNAVAILABLE
        )
        degraded = tuple(
            probe.name
            for probe in declared
            if probe.status is ProbeStatus.DEGRADED
            or (not probe.required and probe.status is ProbeStatus.UNAVAILABLE)
        )
        if blockers:
            mode = ResourceMode.RESOURCE_BLOCKED
        elif degraded:
            mode = ResourceMode.DEGRADED
        else:
            mode = ResourceMode.READY
        return RealisticResourceResult(mode, declared, blockers, degraded)
