"""Code-enforced F1-F11 failure taxonomy for synthetic RC1 runs."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Iterable

from .state_machine import State, StateMachine


class FailureCode(str, Enum):
    F1 = "F1"
    F2 = "F2"
    F3 = "F3"
    F4 = "F4"
    F5 = "F5"
    F6 = "F6"
    F7 = "F7"
    F8 = "F8"
    F9 = "F9"
    F10 = "F10"
    F11 = "F11"


FAILURE_TRANSITIONS: dict[FailureCode, frozenset[State]] = {
    FailureCode.F1: frozenset({State.WRONG_WORKTREE}),
    FailureCode.F2: frozenset({State.WIP_BLOCKED}),
    FailureCode.F3: frozenset({State.PERMISSION_BLOCKED}),
    FailureCode.F4: frozenset({State.RESOURCE_BLOCKED}),
    FailureCode.F5: frozenset({State.ENVIRONMENT_BLOCKED}),
    FailureCode.F6: frozenset({State.HARNESS_BLOCKED}),
    FailureCode.F7: frozenset({State.NEEDS_FIX}),
    FailureCode.F8: frozenset({State.ESCALATED}),
    FailureCode.F9: frozenset({State.ESCALATED}),
    FailureCode.F10: frozenset({State.NEEDS_FIX, State.ESCALATED}),
    FailureCode.F11: frozenset({State.CODEX_REJECTED, State.ESCALATED}),
}

FAILURE_CLASSIFICATIONS: dict[FailureCode, str] = {
    FailureCode.F1: "WRONG_WORKTREE",
    FailureCode.F2: "WIP_UNSAFE",
    FailureCode.F3: "PERMISSION_OR_SCOPE_VIOLATION",
    FailureCode.F4: "RESOURCE_UNAVAILABLE",
    FailureCode.F5: "ENVIRONMENT_INVALID",
    FailureCode.F6: "HARNESS_FAILURE",
    FailureCode.F7: "FUNCTIONAL_FAILURE_CONFIRMED",
    FailureCode.F8: "UNKNOWN_CAUSE_OR_CONTRADICTION",
    FailureCode.F9: "WRITE_TRANSACTION_FAILURE",
    FailureCode.F10: "REVIEW_OR_VERIFY_REJECTION",
    FailureCode.F11: "CODEX_HANDOFF_OR_RESULT_FAILURE",
}


class FailurePolicyError(Exception):
    pass


class FailureTransitionError(FailurePolicyError):
    pass


@dataclass(frozen=True)
class FailureRecord:
    failure_id: str
    run_id: str
    cycle_id: int
    code: FailureCode
    subcode: str
    detected_in_state: State
    classification: str
    description: str
    evidence_refs: tuple[str, ...]
    related_failures: tuple[str, ...]
    transition: State
    retry_eligible: bool

    def to_dict(self) -> dict[str, object]:
        payload = asdict(self)
        payload["code"] = self.code.value
        payload["detected_in_state"] = self.detected_in_state.value
        payload["transition"] = self.transition.value
        payload["evidence_refs"] = list(self.evidence_refs)
        payload["related_failures"] = list(self.related_failures)
        return payload


class FailureTaxonomy:
    """Creates records only after deriving their transition from RC1 policy."""

    def __init__(self) -> None:
        self._counter = 0

    @staticmethod
    def assert_allowed_transition(code: FailureCode, transition: State) -> None:
        if transition not in FAILURE_TRANSITIONS[code]:
            raise FailureTransitionError(f"{code.value} cannot transition to {transition.value}")

    def create_failure(
        self,
        *,
        run_id: str,
        cycle_id: int,
        code: FailureCode,
        subcode: str,
        detected_in_state: State,
        description: str,
        evidence_refs: Iterable[str] = (),
        related_failures: Iterable[str] = (),
        actionable: bool | None = None,
        codex_result: str | None = None,
        requested_transition: State | None = None,
    ) -> FailureRecord:
        if not run_id or isinstance(cycle_id, bool) or not isinstance(cycle_id, int) or cycle_id < 1:
            raise FailurePolicyError("run_id and positive integer cycle_id are required")
        if not subcode or not description:
            raise FailurePolicyError("subcode and description are required")

        effective_code = code
        effective_subcode = subcode
        related = tuple(related_failures)
        if code is FailureCode.F10:
            if actionable is None:
                raise FailurePolicyError("F10 requires actionable=true/false")
            if actionable:
                transition = State.NEEDS_FIX
                retry_eligible = True
            else:
                effective_code = FailureCode.F8
                effective_subcode = "f10_non_actionable:" + subcode
                related = (*related, FailureCode.F10.value)
                transition = State.ESCALATED
                retry_eligible = False
        elif code is FailureCode.F11:
            if codex_result == "valid_rejection":
                transition = State.CODEX_REJECTED
            elif codex_result == "invalid_result":
                transition = State.ESCALATED
            else:
                raise FailurePolicyError("F11 requires codex_result=valid_rejection|invalid_result")
            retry_eligible = False
        else:
            transition = next(iter(FAILURE_TRANSITIONS[code]))
            retry_eligible = code is FailureCode.F7

        self.assert_allowed_transition(effective_code, transition)
        if requested_transition is not None and requested_transition is not transition:
            raise FailureTransitionError(
                f"requested {requested_transition.value}; policy requires {transition.value}"
            )

        self._counter += 1
        return FailureRecord(
            failure_id=f"failure-{self._counter:04d}",
            run_id=run_id,
            cycle_id=cycle_id,
            code=effective_code,
            subcode=effective_subcode,
            detected_in_state=detected_in_state,
            classification=FAILURE_CLASSIFICATIONS[effective_code],
            description=description,
            evidence_refs=tuple(evidence_refs),
            related_failures=related,
            transition=transition,
            retry_eligible=retry_eligible,
        )

    def apply_failure(self, machine: StateMachine, **kwargs: object) -> FailureRecord:
        record = self.create_failure(
            run_id=machine.history[0].run_id,
            cycle_id=machine.history[0].cycle_id,
            detected_in_state=machine.current,
            **kwargs,
        )
        machine.transition(record.transition, reason=record.failure_id)
        return record
