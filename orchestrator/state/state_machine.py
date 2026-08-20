"""Append-only synthetic state machine for Orchestrator V1 RC1."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from enum import Enum
from typing import Iterable


class State(str, Enum):
    RECEIVED = "RECEIVED"
    PREFLIGHT_RUNNING = "PREFLIGHT_RUNNING"
    PREFLIGHT_PASSED = "PREFLIGHT_PASSED"
    RESOURCE_CHECK = "RESOURCE_CHECK"
    RESOURCE_READY = "RESOURCE_READY"
    SCOPED = "SCOPED"
    INVESTIGATING = "INVESTIGATING"
    CAUSE_CONFIRMED = "CAUSE_CONFIRMED"
    CONTRACT_READY = "CONTRACT_READY"
    IMPLEMENTING = "IMPLEMENTING"
    IMPLEMENTED = "IMPLEMENTED"
    TESTING = "TESTING"
    ADVERSARIAL_TESTING = "ADVERSARIAL_TESTING"
    REVIEWING = "REVIEWING"
    VERIFYING = "VERIFYING"
    READY_FOR_CODEX_REVIEW = "READY_FOR_CODEX_REVIEW"

    READ_ONLY_COMPLETE = "READ_ONLY_COMPLETE"
    APPROVED = "APPROVED"
    CODEX_APPROVED = "CODEX_APPROVED"
    CODEX_REJECTED = "CODEX_REJECTED"
    REJECTED = "REJECTED"
    ESCALATED = "ESCALATED"
    WRONG_WORKTREE = "WRONG_WORKTREE"
    WIP_BLOCKED = "WIP_BLOCKED"
    ENVIRONMENT_BLOCKED = "ENVIRONMENT_BLOCKED"
    PERMISSION_BLOCKED = "PERMISSION_BLOCKED"
    HARNESS_BLOCKED = "HARNESS_BLOCKED"
    RESOURCE_BLOCKED = "RESOURCE_BLOCKED"
    CANCELLED = "CANCELLED"
    NEEDS_FIX = "NEEDS_FIX"


TERMINAL_STATES = frozenset(
    {
        State.READ_ONLY_COMPLETE,
        State.APPROVED,
        State.CODEX_APPROVED,
        State.CODEX_REJECTED,
        State.REJECTED,
        State.ESCALATED,
        State.WRONG_WORKTREE,
        State.WIP_BLOCKED,
        State.ENVIRONMENT_BLOCKED,
        State.PERMISSION_BLOCKED,
        State.HARNESS_BLOCKED,
        State.RESOURCE_BLOCKED,
        State.CANCELLED,
        State.NEEDS_FIX,
    }
)


LEGAL_TRANSITIONS: dict[State, frozenset[State]] = {
    State.RECEIVED: frozenset({State.PREFLIGHT_RUNNING, State.CANCELLED}),
    State.PREFLIGHT_RUNNING: frozenset(
        {
            State.PREFLIGHT_PASSED,
            State.WRONG_WORKTREE,
            State.WIP_BLOCKED,
            State.ENVIRONMENT_BLOCKED,
            State.PERMISSION_BLOCKED,
            State.CANCELLED,
        }
    ),
    State.PREFLIGHT_PASSED: frozenset(
        {State.RESOURCE_CHECK, State.ENVIRONMENT_BLOCKED, State.PERMISSION_BLOCKED, State.CANCELLED}
    ),
    State.RESOURCE_CHECK: frozenset({State.RESOURCE_READY, State.RESOURCE_BLOCKED, State.CANCELLED}),
    State.RESOURCE_READY: frozenset({State.SCOPED, State.READ_ONLY_COMPLETE, State.CANCELLED}),
    State.SCOPED: frozenset(
        {State.INVESTIGATING, State.CONTRACT_READY, State.READ_ONLY_COMPLETE, State.PERMISSION_BLOCKED, State.CANCELLED}
    ),
    State.INVESTIGATING: frozenset(
        {State.CAUSE_CONFIRMED, State.READ_ONLY_COMPLETE, State.ESCALATED, State.ENVIRONMENT_BLOCKED, State.CANCELLED}
    ),
    State.CAUSE_CONFIRMED: frozenset({State.CONTRACT_READY, State.ESCALATED, State.CANCELLED}),
    State.CONTRACT_READY: frozenset(
        {
            State.IMPLEMENTING,
            State.TESTING,
            State.REVIEWING,
            State.READ_ONLY_COMPLETE,
            State.PERMISSION_BLOCKED,
            State.CANCELLED,
        }
    ),
    State.IMPLEMENTING: frozenset(
        {State.IMPLEMENTED, State.NEEDS_FIX, State.ESCALATED, State.PERMISSION_BLOCKED, State.CANCELLED}
    ),
    State.IMPLEMENTED: frozenset({State.TESTING, State.ESCALATED, State.CANCELLED}),
    State.TESTING: frozenset(
        {
            State.ADVERSARIAL_TESTING,
            State.REVIEWING,
            State.NEEDS_FIX,
            State.HARNESS_BLOCKED,
            State.ENVIRONMENT_BLOCKED,
            State.CANCELLED,
        }
    ),
    State.ADVERSARIAL_TESTING: frozenset(
        {State.REVIEWING, State.NEEDS_FIX, State.HARNESS_BLOCKED, State.ENVIRONMENT_BLOCKED, State.CANCELLED}
    ),
    State.REVIEWING: frozenset(
        {
            State.VERIFYING,
            State.READY_FOR_CODEX_REVIEW,
            State.NEEDS_FIX,
            State.REJECTED,
            State.ESCALATED,
            State.CANCELLED,
        }
    ),
    State.VERIFYING: frozenset(
        {
            State.APPROVED,
            State.READY_FOR_CODEX_REVIEW,
            State.NEEDS_FIX,
            State.REJECTED,
            State.ESCALATED,
            State.CANCELLED,
        }
    ),
    State.READY_FOR_CODEX_REVIEW: frozenset(
        {State.CODEX_APPROVED, State.CODEX_REJECTED, State.ESCALATED, State.CANCELLED}
    ),
}


class StateMachineError(Exception):
    """Base class for enforced state-machine failures."""


class IllegalTransitionError(StateMachineError):
    pass


class TerminalStateError(StateMachineError):
    pass


class SequenceError(StateMachineError):
    pass


class HistoryIntegrityError(StateMachineError):
    pass


@dataclass(frozen=True)
class StateEvent:
    run_id: str
    cycle_id: int
    session_id: str
    sequence: int
    state: State
    reason: str
    previous_digest: str
    digest: str

    @classmethod
    def create(
        cls,
        *,
        run_id: str,
        cycle_id: int,
        session_id: str,
        sequence: int,
        state: State,
        reason: str,
        previous_digest: str,
    ) -> "StateEvent":
        digest = _event_digest(
            run_id=run_id,
            cycle_id=cycle_id,
            session_id=session_id,
            sequence=sequence,
            state=state,
            reason=reason,
            previous_digest=previous_digest,
        )
        return cls(run_id, cycle_id, session_id, sequence, state, reason, previous_digest, digest)


def _event_digest(
    *,
    run_id: str,
    cycle_id: int,
    session_id: str,
    sequence: int,
    state: State,
    reason: str,
    previous_digest: str,
) -> str:
    payload = {
        "cycle_id": cycle_id,
        "previous_digest": previous_digest,
        "reason": reason,
        "run_id": run_id,
        "sequence": sequence,
        "session_id": session_id,
        "state": state.value,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def validate_history(events: Iterable[StateEvent]) -> tuple[StateEvent, ...]:
    history = tuple(events)
    if not history:
        raise HistoryIntegrityError("state history cannot be empty")
    identity = (history[0].run_id, history[0].cycle_id, history[0].session_id)
    previous: StateEvent | None = None
    for index, event in enumerate(history, start=1):
        if event.sequence != index:
            raise SequenceError(f"expected sequence {index}, observed {event.sequence}")
        if (event.run_id, event.cycle_id, event.session_id) != identity:
            raise HistoryIntegrityError("run/cycle/session identity changed inside a state log")
        expected_previous = "GENESIS" if previous is None else previous.digest
        if event.previous_digest != expected_previous:
            raise HistoryIntegrityError(f"broken digest chain at sequence {event.sequence}")
        expected_digest = _event_digest(
            run_id=event.run_id,
            cycle_id=event.cycle_id,
            session_id=event.session_id,
            sequence=event.sequence,
            state=event.state,
            reason=event.reason,
            previous_digest=event.previous_digest,
        )
        if event.digest != expected_digest:
            raise HistoryIntegrityError(f"historical event changed at sequence {event.sequence}")
        if previous is None:
            if event.state is not State.RECEIVED:
                raise HistoryIntegrityError("first state must be RECEIVED")
        else:
            if previous.state in TERMINAL_STATES:
                raise TerminalStateError(f"terminal state {previous.state.value} has an outgoing transition")
            if event.state not in LEGAL_TRANSITIONS.get(previous.state, frozenset()):
                raise IllegalTransitionError(f"illegal transition {previous.state.value} -> {event.state.value}")
        previous = event
    return history


class StateMachine:
    """One immutable-history state log for one logical cycle/session."""

    def __init__(self, *, run_id: str, cycle_id: int, session_id: str) -> None:
        if (
            not run_id
            or not session_id
            or isinstance(cycle_id, bool)
            or not isinstance(cycle_id, int)
            or cycle_id < 1
        ):
            raise ValueError("run_id/session_id must be non-empty and cycle_id must be positive")
        self._events: list[StateEvent] = [
            StateEvent.create(
                run_id=run_id,
                cycle_id=cycle_id,
                session_id=session_id,
                sequence=1,
                state=State.RECEIVED,
                reason="run received",
                previous_digest="GENESIS",
            )
        ]

    @property
    def history(self) -> tuple[StateEvent, ...]:
        return tuple(self._events)

    @property
    def current(self) -> State:
        return self._events[-1].state

    @property
    def sequence(self) -> int:
        return self._events[-1].sequence

    def transition(self, target: State, *, reason: str, sequence: int | None = None) -> StateEvent:
        if self.current in TERMINAL_STATES:
            raise TerminalStateError(f"terminal state {self.current.value} is immutable")
        if target not in LEGAL_TRANSITIONS.get(self.current, frozenset()):
            raise IllegalTransitionError(f"illegal transition {self.current.value} -> {target.value}")
        expected_sequence = self.sequence + 1
        if sequence is not None and sequence != expected_sequence:
            raise SequenceError(f"expected sequence {expected_sequence}, observed {sequence}")
        previous = self._events[-1]
        event = StateEvent.create(
            run_id=previous.run_id,
            cycle_id=previous.cycle_id,
            session_id=previous.session_id,
            sequence=expected_sequence,
            state=target,
            reason=reason,
            previous_digest=previous.digest,
        )
        self._events.append(event)
        validate_history(self._events)
        return event
