"""Cycle/session/corrective-attempt guard for Orchestrator V1 RC1."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Mapping
from typing import Iterable

from orchestrator.io_atomic import atomic_write_json

from .state_machine import State


class ActionKind(str, Enum):
    CORRECTIVE = "CORRECTIVE"
    READ_ONLY = "READ_ONLY"
    TEST = "TEST"
    REVIEW = "REVIEW"
    VERIFICATION = "VERIFICATION"
    RESOURCE_CHECK = "RESOURCE_CHECK"
    PROVIDER_CHECK = "PROVIDER_CHECK"
    TOOL_CHECK = "TOOL_CHECK"


class CycleOutcome(str, Enum):
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    RESOURCE_BLOCKED = "RESOURCE_BLOCKED"
    PROVIDER_FAILURE = "PROVIDER_FAILURE"
    TOOL_FAILURE = "TOOL_FAILURE"
    EXTERNAL_DEPENDENCY = "EXTERNAL_DEPENDENCY"
    UNKNOWN = "UNKNOWN"
    CONTRADICTION = "CONTRADICTION"


class CycleDecision(str, Enum):
    COMPLETE = "COMPLETE"
    RETRY_ALLOWED = "RETRY_ALLOWED"
    RESOURCE_BLOCKED = "RESOURCE_BLOCKED"
    NOT_EVALUABLE = "NOT_EVALUABLE"
    ESCALATED = "ESCALATED"


class AntiLoopError(Exception):
    pass


class DuplicateCorrectiveAttempt(AntiLoopError):
    pass


class CycleSequenceError(AntiLoopError):
    pass


class SessionReuseError(AntiLoopError):
    pass


class NewEvidenceRequired(AntiLoopError):
    pass


class CycleNotClosed(AntiLoopError):
    pass


class CycleLimitEscalation(AntiLoopError):
    transition = State.ESCALATED


@dataclass(frozen=True)
class CycleRecord:
    run_id: str
    cycle_id: int
    hypothesis_id: str
    session_id: str
    evidence_refs: tuple[str, ...]


@dataclass(frozen=True)
class ActionReceipt:
    run_id: str
    cycle_id: int
    hypothesis_id: str
    model_id: str
    corrective_role: str
    action_kind: ActionKind
    corrective_attempt_consumed: bool

    @property
    def uniqueness_key(self) -> tuple[str, int, str, str, str]:
        return (
            self.run_id,
            self.cycle_id,
            self.hypothesis_id,
            self.model_id,
            self.corrective_role,
        )


class AntiLoopGuard:
    """Maintains recoverable cycle policy; it performs no orchestration."""

    def __init__(self, *, max_cycles: int = 3) -> None:
        if isinstance(max_cycles, bool) or not isinstance(max_cycles, int) or max_cycles != 3:
            raise ValueError("RC1 requires max_cycles=3")
        self.max_cycles = max_cycles
        self._chains: dict[tuple[str, str], list[CycleRecord]] = {}
        self._closed: dict[tuple[str, int, str], CycleOutcome] = {}
        self._attempt_keys: set[tuple[str, int, str, str, str]] = set()
        self._model_cycle_attempts: set[tuple[str, int, str]] = set()

    def start_cycle(
        self,
        *,
        run_id: str,
        cycle_id: int,
        hypothesis_id: str,
        session_id: str,
        evidence_refs: Iterable[str] = (),
    ) -> CycleRecord:
        if not run_id or not hypothesis_id or not session_id:
            raise AntiLoopError("run_id, hypothesis_id and session_id are required")
        if isinstance(cycle_id, bool) or not isinstance(cycle_id, int) or cycle_id < 1:
            raise CycleSequenceError("cycle_id must be a positive integer")
        evidence = tuple(evidence_refs)
        if len(set(evidence)) != len(evidence) or any(not ref for ref in evidence):
            raise AntiLoopError("evidence_refs must be non-empty and unique")

        chain_key = (run_id, hypothesis_id)
        chain = self._chains.setdefault(chain_key, [])
        if len(chain) >= self.max_cycles:
            raise CycleLimitEscalation(f"hypothesis chain reached {self.max_cycles} cycles")
        expected_cycle = len(chain) + 1
        if cycle_id != expected_cycle:
            raise CycleSequenceError(f"expected new cycle {expected_cycle}, observed {cycle_id}")
        if chain:
            prior = chain[-1]
            prior_key = (prior.run_id, prior.cycle_id, prior.hypothesis_id)
            if prior_key not in self._closed:
                raise CycleNotClosed("previous cycle must terminate before retry")
            if session_id in {item.session_id for item in chain}:
                raise SessionReuseError("retry requires a new logical session_id")
            prior_evidence = {ref for item in chain for ref in item.evidence_refs}
            if not (set(evidence) - prior_evidence):
                raise NewEvidenceRequired("cycles after cycle 1 require at least one new evidence ref")

        cycle = CycleRecord(run_id, cycle_id, hypothesis_id, session_id, evidence)
        chain.append(cycle)
        return cycle

    def register_action(
        self,
        cycle: CycleRecord,
        *,
        model_id: str,
        corrective_role: str,
        action_kind: ActionKind,
    ) -> ActionReceipt:
        chain = self._chains.get((cycle.run_id, cycle.hypothesis_id), [])
        if cycle not in chain:
            raise AntiLoopError("cycle was not started by this guard")
        cycle_key = (cycle.run_id, cycle.cycle_id, cycle.hypothesis_id)
        if cycle_key in self._closed:
            raise AntiLoopError("closed cycle cannot accept actions")
        if not model_id or not corrective_role:
            raise AntiLoopError("model_id and corrective_role are required")

        receipt = ActionReceipt(
            cycle.run_id,
            cycle.cycle_id,
            cycle.hypothesis_id,
            model_id,
            corrective_role,
            action_kind,
            action_kind is ActionKind.CORRECTIVE,
        )
        if action_kind is ActionKind.CORRECTIVE:
            model_cycle_key = (cycle.run_id, cycle.cycle_id, model_id)
            if receipt.uniqueness_key in self._attempt_keys or model_cycle_key in self._model_cycle_attempts:
                raise DuplicateCorrectiveAttempt(
                    "only one corrective attempt per model/cycle and uniqueness key is allowed"
                )
            self._attempt_keys.add(receipt.uniqueness_key)
            self._model_cycle_attempts.add(model_cycle_key)
        return receipt

    def finish_cycle(self, cycle: CycleRecord, outcome: CycleOutcome) -> CycleDecision:
        chain = self._chains.get((cycle.run_id, cycle.hypothesis_id), [])
        if cycle not in chain:
            raise AntiLoopError("cycle was not started by this guard")
        key = (cycle.run_id, cycle.cycle_id, cycle.hypothesis_id)
        if key in self._closed:
            raise AntiLoopError("cycle already terminated")
        self._closed[key] = outcome
        if outcome is CycleOutcome.SUCCEEDED:
            return CycleDecision.COMPLETE
        if outcome is CycleOutcome.RESOURCE_BLOCKED:
            return CycleDecision.RESOURCE_BLOCKED
        if outcome in {
            CycleOutcome.PROVIDER_FAILURE,
            CycleOutcome.TOOL_FAILURE,
            CycleOutcome.EXTERNAL_DEPENDENCY,
        }:
            return CycleDecision.NOT_EVALUABLE
        if outcome in {CycleOutcome.UNKNOWN, CycleOutcome.CONTRADICTION}:
            return CycleDecision.ESCALATED
        if cycle.cycle_id == self.max_cycles:
            return CycleDecision.ESCALATED
        return CycleDecision.RETRY_ALLOWED

    @property
    def corrective_attempt_count(self) -> int:
        return len(self._attempt_keys)

    def to_dict(self) -> dict[str, Any]:
        cycles = [
            {
                "run_id": cycle.run_id,
                "cycle_id": cycle.cycle_id,
                "hypothesis_id": cycle.hypothesis_id,
                "session_id": cycle.session_id,
                "evidence_refs": list(cycle.evidence_refs),
            }
            for chain in self._chains.values()
            for cycle in chain
        ]
        closed = [
            {
                "run_id": key[0],
                "cycle_id": key[1],
                "hypothesis_id": key[2],
                "outcome": outcome.value,
            }
            for key, outcome in sorted(self._closed.items())
        ]
        return {
            "schema": "anti-loop@1",
            "max_cycles": self.max_cycles,
            "cycles": cycles,
            "closed": closed,
            "attempt_keys": [list(key) for key in sorted(self._attempt_keys)],
            "model_cycle_attempts": [list(key) for key in sorted(self._model_cycle_attempts)],
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "AntiLoopGuard":
        fields = {
            "schema",
            "max_cycles",
            "cycles",
            "closed",
            "attempt_keys",
            "model_cycle_attempts",
        }
        if not isinstance(value, dict) or set(value) != fields or value["schema"] != "anti-loop@1":
            raise AntiLoopError("invalid durable anti-loop snapshot")
        guard = cls(max_cycles=value["max_cycles"])
        closed = value["closed"]
        if not isinstance(closed, list):
            raise AntiLoopError("closed must be a list")
        for raw in closed:
            if not isinstance(raw, dict) or set(raw) != {
                "run_id",
                "cycle_id",
                "hypothesis_id",
                "outcome",
            }:
                raise AntiLoopError("invalid durable closed cycle")
            key = (raw["run_id"], raw["cycle_id"], raw["hypothesis_id"])
            if key in guard._closed:
                raise AntiLoopError("duplicate durable closed cycle")
            guard._closed[key] = CycleOutcome(raw["outcome"])
        cycles = value["cycles"]
        if not isinstance(cycles, list):
            raise AntiLoopError("cycles must be a list")
        for raw in cycles:
            if not isinstance(raw, dict) or set(raw) != {
                "run_id",
                "cycle_id",
                "hypothesis_id",
                "session_id",
                "evidence_refs",
            }:
                raise AntiLoopError("invalid durable cycle")
            cycle = CycleRecord(
                raw["run_id"],
                raw["cycle_id"],
                raw["hypothesis_id"],
                raw["session_id"],
                tuple(raw["evidence_refs"]),
            )
            chain = guard._chains.setdefault((cycle.run_id, cycle.hypothesis_id), [])
            if cycle.cycle_id != len(chain) + 1 or len(chain) >= guard.max_cycles:
                raise AntiLoopError("invalid durable cycle sequence")
            if len(set(cycle.evidence_refs)) != len(cycle.evidence_refs) or any(
                not ref for ref in cycle.evidence_refs
            ):
                raise AntiLoopError("invalid durable evidence refs")
            if chain:
                prior = chain[-1]
                if (prior.run_id, prior.cycle_id, prior.hypothesis_id) not in guard._closed:
                    raise AntiLoopError("durable prior cycle is not closed")
                if cycle.session_id in {item.session_id for item in chain}:
                    raise AntiLoopError("durable session was reused")
                prior_evidence = {ref for item in chain for ref in item.evidence_refs}
                if not (set(cycle.evidence_refs) - prior_evidence):
                    raise AntiLoopError("durable retry has no new evidence")
            chain.append(cycle)
        try:
            guard._attempt_keys = {
                (str(item[0]), int(item[1]), str(item[2]), str(item[3]), str(item[4]))
                for item in value["attempt_keys"]
                if len(item) == 5
            }
            guard._model_cycle_attempts = {
                (str(item[0]), int(item[1]), str(item[2]))
                for item in value["model_cycle_attempts"]
                if len(item) == 3
            }
        except (TypeError, ValueError, IndexError) as exc:
            raise AntiLoopError("invalid durable attempt keys") from exc
        if len(guard._attempt_keys) != len(value["attempt_keys"]):
            raise AntiLoopError("invalid or duplicate durable attempt keys")
        if len(guard._model_cycle_attempts) != len(value["model_cycle_attempts"]):
            raise AntiLoopError("invalid or duplicate durable model attempts")
        return guard

    def save(self, path: Path) -> None:
        atomic_write_json(Path(path), self.to_dict())

    @classmethod
    def load(cls, path: Path) -> "AntiLoopGuard":
        import json

        try:
            value = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise AntiLoopError(f"anti-loop snapshot unreadable: {exc}") from exc
        return cls.from_dict(value)
