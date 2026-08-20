"""Durable one-shot state, append-only event history and crash recovery."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Mapping

from orchestrator.io_atomic import (
    append_durable_line,
    atomic_write_json,
    canonical_json_bytes,
    sha256_digest,
)

from .state_machine import LEGAL_TRANSITIONS, TERMINAL_STATES, State


RECORD_FIELDS = frozenset(
    {
        "run_id",
        "cycle_id",
        "task_id",
        "state",
        "previous_state",
        "timestamp",
        "model",
        "attempt",
        "risk",
        "failure_class",
        "repo",
        "branch",
        "head",
        "worktree",
        "wip_fingerprint",
        "manifest_digest",
        "evidence_digest",
        "next_action",
    }
)
SNAPSHOT_FIELDS = frozenset({"record", "event_sequence", "event_digest"})
EVENT_FIELDS = frozenset({"sequence", "previous_digest", "record", "digest"})


class DurableStateError(Exception):
    pass


class DurableStateCorruption(DurableStateError):
    pass


class DurableIllegalTransition(DurableStateError):
    pass


class DurableTerminalState(DurableStateError):
    pass


class SimulatedCrash(DurableStateError):
    pass


class RecoveryStatus(str, Enum):
    RECOVERABLE = "RECOVERABLE"
    BLOCKED = "BLOCKED"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _nonempty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise DurableStateCorruption(f"{field} must be a non-empty string")
    return value


def _digest(value: Any, field: str) -> str:
    result = _nonempty(value, field)
    if not result.startswith("sha256:") or len(result) != 71:
        raise DurableStateCorruption(f"{field} must be a SHA-256 digest")
    try:
        int(result[7:], 16)
    except ValueError as exc:
        raise DurableStateCorruption(f"{field} must be a SHA-256 digest") from exc
    return result


@dataclass(frozen=True)
class DurableStateRecord:
    run_id: str
    cycle_id: int
    task_id: str
    state: State
    previous_state: State | None
    timestamp: str
    model: str
    attempt: int
    risk: str
    failure_class: str | None
    repo: str
    branch: str
    head: str
    worktree: str
    wip_fingerprint: str
    manifest_digest: str
    evidence_digest: str
    next_action: str

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "DurableStateRecord":
        if not isinstance(value, dict) or set(value) != RECORD_FIELDS:
            raise DurableStateCorruption("state record has unknown or missing fields")
        cycle_id, attempt = value["cycle_id"], value["attempt"]
        if isinstance(cycle_id, bool) or not isinstance(cycle_id, int) or cycle_id < 1:
            raise DurableStateCorruption("cycle_id must be a positive integer")
        if isinstance(attempt, bool) or not isinstance(attempt, int) or attempt < 0:
            raise DurableStateCorruption("attempt must be a non-negative integer")
        try:
            state = State(value["state"])
            previous_state = State(value["previous_state"]) if value["previous_state"] is not None else None
        except (TypeError, ValueError) as exc:
            raise DurableStateCorruption("unknown state") from exc
        timestamp = _nonempty(value["timestamp"], "timestamp")
        try:
            parsed_timestamp = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError as exc:
            raise DurableStateCorruption("timestamp is not ISO-8601") from exc
        if parsed_timestamp.tzinfo is None:
            raise DurableStateCorruption("timestamp must include a timezone")
        failure_class = value["failure_class"]
        if failure_class is not None and (not isinstance(failure_class, str) or not failure_class):
            raise DurableStateCorruption("failure_class must be null or non-empty string")
        return cls(
            run_id=_nonempty(value["run_id"], "run_id"),
            cycle_id=cycle_id,
            task_id=_nonempty(value["task_id"], "task_id"),
            state=state,
            previous_state=previous_state,
            timestamp=timestamp,
            model=_nonempty(value["model"], "model"),
            attempt=attempt,
            risk=_nonempty(value["risk"], "risk"),
            failure_class=failure_class,
            repo=_nonempty(value["repo"], "repo"),
            branch=_nonempty(value["branch"], "branch"),
            head=_nonempty(value["head"], "head"),
            worktree=_nonempty(value["worktree"], "worktree"),
            wip_fingerprint=_digest(value["wip_fingerprint"], "wip_fingerprint"),
            manifest_digest=_digest(value["manifest_digest"], "manifest_digest"),
            evidence_digest=_digest(value["evidence_digest"], "evidence_digest"),
            next_action=_nonempty(value["next_action"], "next_action"),
        )

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["state"] = self.state.value
        value["previous_state"] = self.previous_state.value if self.previous_state else None
        return value


@dataclass(frozen=True)
class DurableEvent:
    sequence: int
    previous_digest: str
    record: DurableStateRecord
    digest: str

    @classmethod
    def create(cls, sequence: int, previous_digest: str, record: DurableStateRecord) -> "DurableEvent":
        body = {
            "sequence": sequence,
            "previous_digest": previous_digest,
            "record": record.to_dict(),
        }
        return cls(sequence, previous_digest, record, sha256_digest(body))

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "DurableEvent":
        if not isinstance(value, dict) or set(value) != EVENT_FIELDS:
            raise DurableStateCorruption("event has unknown or missing fields")
        sequence = value["sequence"]
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise DurableStateCorruption("event sequence must be positive")
        previous_digest = _nonempty(value["previous_digest"], "previous_digest")
        record = DurableStateRecord.from_dict(value["record"])
        digest = _digest(value["digest"], "event.digest")
        event = cls.create(sequence, previous_digest, record)
        if digest != event.digest:
            raise DurableStateCorruption(f"event digest mismatch at sequence {sequence}")
        return event

    def to_dict(self) -> dict[str, Any]:
        return {
            "sequence": self.sequence,
            "previous_digest": self.previous_digest,
            "record": self.record.to_dict(),
            "digest": self.digest,
        }


@dataclass(frozen=True)
class StateSnapshot:
    record: DurableStateRecord
    event_sequence: int
    event_digest: str

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "StateSnapshot":
        if not isinstance(value, dict) or set(value) != SNAPSHOT_FIELDS:
            raise DurableStateCorruption("STATE has unknown or missing fields")
        sequence = value["event_sequence"]
        if isinstance(sequence, bool) or not isinstance(sequence, int) or sequence < 1:
            raise DurableStateCorruption("STATE event_sequence must be positive")
        return cls(
            DurableStateRecord.from_dict(value["record"]),
            sequence,
            _digest(value["event_digest"], "STATE.event_digest"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "record": self.record.to_dict(),
            "event_sequence": self.event_sequence,
            "event_digest": self.event_digest,
        }


@dataclass(frozen=True)
class RecoveryResult:
    status: RecoveryStatus
    record: DurableStateRecord | None
    reason: str
    repaired: bool


def validate_event_log(path: Path) -> tuple[DurableEvent, ...]:
    try:
        payload = Path(path).read_bytes()
    except OSError as exc:
        raise DurableStateCorruption(f"event log unreadable: {exc}") from exc
    if not payload or not payload.endswith(b"\n"):
        raise DurableStateCorruption("event log is empty or partially written")
    events: list[DurableEvent] = []
    for index, line in enumerate(payload.splitlines(), start=1):
        try:
            raw = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise DurableStateCorruption(f"invalid event JSON at line {index}") from exc
        event = DurableEvent.from_dict(raw)
        if event.sequence != index:
            raise DurableStateCorruption(f"event reordering or truncation at sequence {event.sequence}")
        expected_previous = "GENESIS" if not events else events[-1].digest
        if event.previous_digest != expected_previous:
            raise DurableStateCorruption(f"broken event chain at sequence {event.sequence}")
        if not events:
            if event.record.state is not State.RECEIVED or event.record.previous_state is not None:
                raise DurableStateCorruption("first event must be RECEIVED")
        else:
            prior = events[-1].record
            current = event.record
            if current.run_id != prior.run_id or current.task_id != prior.task_id:
                raise DurableStateCorruption("run/task identity changed")
            if (current.repo, current.worktree, current.manifest_digest) != (
                prior.repo,
                prior.worktree,
                prior.manifest_digest,
            ):
                raise DurableStateCorruption("repository identity changed")
            if current.cycle_id == prior.cycle_id:
                if prior.state in TERMINAL_STATES:
                    raise DurableStateCorruption("terminal state has outgoing event")
                if current.previous_state is not prior.state:
                    raise DurableStateCorruption("previous_state contradicts history")
                if current.state not in LEGAL_TRANSITIONS.get(prior.state, frozenset()):
                    raise DurableStateCorruption("illegal state transition in log")
                if current.attempt < prior.attempt:
                    raise DurableStateCorruption("attempt counter moved backwards")
            elif current.cycle_id == prior.cycle_id + 1:
                if prior.state not in TERMINAL_STATES or current.state is not State.RECEIVED:
                    raise DurableStateCorruption("new cycle requires terminal prior state and RECEIVED")
                if current.previous_state is not prior.state:
                    raise DurableStateCorruption("new cycle previous_state mismatch")
            else:
                raise DurableStateCorruption("cycle sequence is inconsistent")
        events.append(event)
    return tuple(events)


class DurableStateStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.state_path = self.root / "STATE.json"
        self.log_path = self.root / "events.jsonl"

    def initialize(self, record: DurableStateRecord) -> StateSnapshot:
        if self.state_path.exists() or self.log_path.exists():
            raise DurableStateError("durable store already initialized")
        record = DurableStateRecord.from_dict(record.to_dict())
        if record.state is not State.RECEIVED or record.previous_state is not None:
            raise DurableStateError("initial state must be RECEIVED")
        event = DurableEvent.create(1, "GENESIS", record)
        append_durable_line(self.log_path, canonical_json_bytes(event.to_dict()) + b"\n")
        snapshot = StateSnapshot(record, event.sequence, event.digest)
        atomic_write_json(self.state_path, snapshot.to_dict())
        return snapshot

    def _read_snapshot(self) -> StateSnapshot:
        try:
            value = json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise DurableStateCorruption(f"STATE unreadable: {exc}") from exc
        return StateSnapshot.from_dict(value)

    def recover(self, *, repair: bool = True) -> RecoveryResult:
        try:
            events = validate_event_log(self.log_path)
        except DurableStateCorruption as exc:
            return RecoveryResult(RecoveryStatus.BLOCKED, None, str(exc), False)
        latest = events[-1]
        try:
            snapshot = self._read_snapshot()
        except DurableStateCorruption:
            if repair:
                atomic_write_json(
                    self.state_path,
                    StateSnapshot(latest.record, latest.sequence, latest.digest).to_dict(),
                )
            return RecoveryResult(
                RecoveryStatus.RECOVERABLE,
                latest.record,
                "STATE rebuilt from valid append-only log",
                repair,
            )
        if snapshot.event_sequence > latest.sequence:
            return RecoveryResult(RecoveryStatus.BLOCKED, None, "STATE is ahead of event log", False)
        anchored = events[snapshot.event_sequence - 1]
        if snapshot.event_digest != anchored.digest or snapshot.record != anchored.record:
            return RecoveryResult(RecoveryStatus.BLOCKED, None, "STATE contradicts event log", False)
        if snapshot.event_sequence < latest.sequence:
            if repair:
                atomic_write_json(
                    self.state_path,
                    StateSnapshot(latest.record, latest.sequence, latest.digest).to_dict(),
                )
            return RecoveryResult(
                RecoveryStatus.RECOVERABLE,
                latest.record,
                "stale STATE advanced from valid event log",
                repair,
            )
        return RecoveryResult(RecoveryStatus.RECOVERABLE, latest.record, "STATE and log agree", False)

    def transition(
        self,
        target: State,
        *,
        next_action: str,
        model: str | None = None,
        attempt: int | None = None,
        failure_class: str | None = None,
        evidence_digest: str | None = None,
        simulate_crash_after_log: bool = False,
    ) -> StateSnapshot:
        recovery = self.recover(repair=True)
        if recovery.status is RecoveryStatus.BLOCKED or recovery.record is None:
            raise DurableStateCorruption(recovery.reason)
        current = recovery.record
        if current.state in TERMINAL_STATES:
            raise DurableTerminalState(f"terminal state {current.state.value} is immutable")
        if target not in LEGAL_TRANSITIONS.get(current.state, frozenset()):
            raise DurableIllegalTransition(f"illegal transition {current.state.value} -> {target.value}")
        events = validate_event_log(self.log_path)
        updated = replace(
            current,
            state=target,
            previous_state=current.state,
            timestamp=utc_now(),
            model=model or current.model,
            attempt=current.attempt if attempt is None else attempt,
            failure_class=failure_class,
            evidence_digest=evidence_digest or current.evidence_digest,
            next_action=_nonempty(next_action, "next_action"),
        )
        updated = DurableStateRecord.from_dict(updated.to_dict())
        event = DurableEvent.create(len(events) + 1, events[-1].digest, updated)
        append_durable_line(self.log_path, canonical_json_bytes(event.to_dict()) + b"\n")
        if simulate_crash_after_log:
            raise SimulatedCrash("synthetic crash after durable event append")
        snapshot = StateSnapshot(updated, event.sequence, event.digest)
        atomic_write_json(self.state_path, snapshot.to_dict())
        return snapshot

    def start_next_cycle(
        self,
        *,
        next_action: str,
        model: str,
        evidence_digest: str,
    ) -> StateSnapshot:
        recovery = self.recover(repair=True)
        if recovery.status is RecoveryStatus.BLOCKED or recovery.record is None:
            raise DurableStateCorruption(recovery.reason)
        current = recovery.record
        if current.state not in TERMINAL_STATES:
            raise DurableStateError("new cycle requires terminal current state")
        events = validate_event_log(self.log_path)
        updated = replace(
            current,
            cycle_id=current.cycle_id + 1,
            state=State.RECEIVED,
            previous_state=current.state,
            timestamp=utc_now(),
            model=model,
            attempt=0,
            failure_class=None,
            evidence_digest=_digest(evidence_digest, "evidence_digest"),
            next_action=_nonempty(next_action, "next_action"),
        )
        updated = DurableStateRecord.from_dict(updated.to_dict())
        event = DurableEvent.create(len(events) + 1, events[-1].digest, updated)
        append_durable_line(self.log_path, canonical_json_bytes(event.to_dict()) + b"\n")
        snapshot = StateSnapshot(updated, event.sequence, event.digest)
        atomic_write_json(self.state_path, snapshot.to_dict())
        return snapshot
