"""Synthetic Orchestrator V1 RC1 state contracts used by INFRA-LAB Phase 2."""

from .anti_loop import ActionKind, AntiLoopGuard, CycleOutcome
from .durable_state import (
    DurableStateRecord,
    DurableStateStore,
    RecoveryResult,
    RecoveryStatus,
    validate_event_log,
)
from .failure_taxonomy import FailureCode, FailureRecord, FailureTaxonomy
from .resource_check import (
    RESOURCE_NAMES,
    ProbeStatus,
    RealisticResourceCheck,
    ResourceCheckResult,
    ResourceMode,
    ResourceRequirement,
    SyntheticResourceAdapter,
)
from .state_machine import State, StateEvent, StateMachine, validate_history

__all__ = [
    "ActionKind",
    "AntiLoopGuard",
    "CycleOutcome",
    "DurableStateRecord",
    "DurableStateStore",
    "FailureCode",
    "FailureRecord",
    "FailureTaxonomy",
    "RESOURCE_NAMES",
    "ProbeStatus",
    "RealisticResourceCheck",
    "RecoveryResult",
    "RecoveryStatus",
    "ResourceCheckResult",
    "ResourceMode",
    "ResourceRequirement",
    "State",
    "StateEvent",
    "StateMachine",
    "SyntheticResourceAdapter",
    "validate_event_log",
    "validate_history",
]
