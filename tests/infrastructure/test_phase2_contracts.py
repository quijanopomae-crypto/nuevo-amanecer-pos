from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path


LAB_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(LAB_ROOT))

from orchestrator.state.anti_loop import (  # noqa: E402
    ActionKind,
    AntiLoopGuard,
    CycleDecision,
    CycleLimitEscalation,
    CycleOutcome,
    CycleSequenceError,
    DuplicateCorrectiveAttempt,
    NewEvidenceRequired,
    SessionReuseError,
)
from orchestrator.state.failure_taxonomy import (  # noqa: E402
    FailureCode,
    FailureTaxonomy,
    FailureTransitionError,
)
from orchestrator.state.resource_check import RESOURCE_NAMES, SyntheticResourceAdapter  # noqa: E402
from orchestrator.state.state_machine import (  # noqa: E402
    HistoryIntegrityError,
    IllegalTransitionError,
    SequenceError,
    State,
    StateMachine,
    TerminalStateError,
    validate_history,
)


def machine_at_resource_check(run_id: str = "run-synthetic") -> StateMachine:
    machine = StateMachine(run_id=run_id, cycle_id=1, session_id="session-1")
    machine.transition(State.PREFLIGHT_RUNNING, reason="synthetic preflight")
    machine.transition(State.PREFLIGHT_PASSED, reason="synthetic preflight pass")
    machine.transition(State.RESOURCE_CHECK, reason="synthetic Resource Check")
    return machine


def machine_at_implementing() -> StateMachine:
    machine = machine_at_resource_check()
    for state in (
        State.RESOURCE_READY,
        State.SCOPED,
        State.INVESTIGATING,
        State.CAUSE_CONFIRMED,
        State.CONTRACT_READY,
        State.IMPLEMENTING,
    ):
        machine.transition(state, reason=f"synthetic {state.value.lower()}")
    return machine


def availability(**overrides: bool) -> dict[str, bool]:
    result = {name: True for name in RESOURCE_NAMES}
    result.update(overrides)
    return result


class StateMachineTests(unittest.TestCase):
    def test_01_legal_simple_flow_reaches_approved(self) -> None:
        machine = StateMachine(run_id="run-legal", cycle_id=1, session_id="session-legal")
        flow = (
            State.PREFLIGHT_RUNNING,
            State.PREFLIGHT_PASSED,
            State.RESOURCE_CHECK,
            State.RESOURCE_READY,
            State.SCOPED,
            State.INVESTIGATING,
            State.CAUSE_CONFIRMED,
            State.CONTRACT_READY,
            State.IMPLEMENTING,
            State.IMPLEMENTED,
            State.TESTING,
            State.ADVERSARIAL_TESTING,
            State.REVIEWING,
            State.VERIFYING,
            State.APPROVED,
        )
        for state in flow:
            machine.transition(state, reason=f"synthetic {state.value.lower()}")
        validated = validate_history(machine.history)
        self.assertEqual(State.APPROVED, machine.current)
        self.assertEqual(list(range(1, len(validated) + 1)), [event.sequence for event in validated])

    def test_02_illegal_implementing_to_received_is_rejected(self) -> None:
        machine = machine_at_implementing()
        with self.assertRaises(IllegalTransitionError):
            machine.transition(State.RECEIVED, reason="forbidden rollback")

    def test_03_terminal_state_has_no_outgoing_transition(self) -> None:
        machine = machine_at_implementing()
        for state in (
            State.IMPLEMENTED,
            State.TESTING,
            State.REVIEWING,
            State.VERIFYING,
            State.APPROVED,
        ):
            machine.transition(state, reason=f"synthetic {state.value.lower()}")
        with self.assertRaises(TerminalStateError):
            machine.transition(State.TESTING, reason="forbidden terminal exit")

    def test_04_sequence_jump_is_rejected(self) -> None:
        machine = StateMachine(run_id="run-sequence", cycle_id=1, session_id="session-sequence")
        with self.assertRaises(SequenceError):
            machine.transition(State.PREFLIGHT_RUNNING, reason="jump", sequence=3)
        self.assertEqual(1, len(machine.history))

    def test_05_changed_historical_event_is_rejected(self) -> None:
        machine = StateMachine(run_id="run-history", cycle_id=1, session_id="session-history")
        machine.transition(State.PREFLIGHT_RUNNING, reason="synthetic preflight")
        changed = list(machine.history)
        changed[1] = replace(changed[1], reason="tampered historical reason")
        with self.assertRaises(HistoryIntegrityError):
            validate_history(changed)


class ResourceCheckTests(unittest.TestCase):
    def test_06_all_resources_available_reaches_resource_ready(self) -> None:
        machine = machine_at_resource_check("run-resources-ready")
        result = SyntheticResourceAdapter.all_available().run(machine, FailureTaxonomy())
        self.assertEqual(State.RESOURCE_READY, result.state)
        self.assertIsNone(result.failure)
        self.assertTrue(all(probe.available for probe in result.probes))

    def test_07_unavailable_model_produces_f4_resource_blocked(self) -> None:
        machine = machine_at_resource_check("run-model-blocked")
        result = SyntheticResourceAdapter(availability(selected_model=False)).run(machine, FailureTaxonomy())
        self.assertEqual(State.RESOURCE_BLOCKED, result.state)
        self.assertEqual(FailureCode.F4, result.failure.code)

    def test_08_insufficient_disk_produces_f4_resource_blocked(self) -> None:
        machine = machine_at_resource_check("run-disk-blocked")
        result = SyntheticResourceAdapter(availability(disk_space=False)).run(machine, FailureTaxonomy())
        self.assertEqual(State.RESOURCE_BLOCKED, result.state)
        self.assertIn("disk_space", result.failure.subcode)

    def test_09_unavailable_evidence_store_produces_f4_resource_blocked(self) -> None:
        machine = machine_at_resource_check("run-evidence-blocked")
        result = SyntheticResourceAdapter(availability(evidence_store=False)).run(machine, FailureTaxonomy())
        self.assertEqual(State.RESOURCE_BLOCKED, result.state)
        self.assertIn("evidence_store", result.failure.subcode)

    def test_10_resource_blocked_does_not_consume_corrective_attempt(self) -> None:
        guard = AntiLoopGuard()
        cycle = guard.start_cycle(
            run_id="run-resource-attempt",
            cycle_id=1,
            hypothesis_id="hypothesis-resource",
            session_id="session-resource",
        )
        machine = machine_at_resource_check("run-resource-attempt")
        result = SyntheticResourceAdapter(availability(selected_model=False)).run(
            machine,
            FailureTaxonomy(),
            anti_loop=guard,
            cycle=cycle,
        )
        self.assertEqual(State.RESOURCE_BLOCKED, result.state)
        self.assertEqual(CycleDecision.RESOURCE_BLOCKED, result.cycle_decision)
        self.assertEqual(0, result.corrective_attempts_consumed)
        self.assertEqual(0, guard.corrective_attempt_count)


class FailureTaxonomyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.taxonomy = FailureTaxonomy()

    def record(self, code: FailureCode, state: State, **kwargs: object):
        return self.taxonomy.create_failure(
            run_id="run-failure",
            cycle_id=1,
            code=code,
            subcode="synthetic",
            detected_in_state=state,
            description="synthetic failure",
            evidence_refs=("evidence:synthetic",),
            **kwargs,
        )

    def test_11_f1_maps_to_wrong_worktree_and_override_is_blocked(self) -> None:
        record = self.record(FailureCode.F1, State.PREFLIGHT_RUNNING)
        self.assertEqual(State.WRONG_WORKTREE, record.transition)
        self.assertEqual(
            {
                "failure_id",
                "run_id",
                "cycle_id",
                "code",
                "subcode",
                "detected_in_state",
                "classification",
                "description",
                "evidence_refs",
                "related_failures",
                "transition",
                "retry_eligible",
            },
            set(record.to_dict()),
        )
        with self.assertRaises(FailureTransitionError):
            self.record(FailureCode.F1, State.PREFLIGHT_RUNNING, requested_transition=State.APPROVED)

    def test_12_f2_maps_to_wip_blocked(self) -> None:
        self.assertEqual(State.WIP_BLOCKED, self.record(FailureCode.F2, State.PREFLIGHT_RUNNING).transition)

    def test_13_f3_maps_to_permission_blocked(self) -> None:
        self.assertEqual(State.PERMISSION_BLOCKED, self.record(FailureCode.F3, State.SCOPED).transition)

    def test_14_f4_maps_to_resource_blocked(self) -> None:
        self.assertEqual(State.RESOURCE_BLOCKED, self.record(FailureCode.F4, State.RESOURCE_CHECK).transition)

    def test_15_f5_maps_to_environment_blocked(self) -> None:
        self.assertEqual(State.ENVIRONMENT_BLOCKED, self.record(FailureCode.F5, State.PREFLIGHT_RUNNING).transition)

    def test_16_f6_maps_to_harness_blocked(self) -> None:
        self.assertEqual(State.HARNESS_BLOCKED, self.record(FailureCode.F6, State.TESTING).transition)

    def test_17_f7_maps_to_needs_fix(self) -> None:
        record = self.record(FailureCode.F7, State.TESTING)
        self.assertEqual(State.NEEDS_FIX, record.transition)
        self.assertTrue(record.retry_eligible)

    def test_18_f8_maps_to_escalated(self) -> None:
        self.assertEqual(State.ESCALATED, self.record(FailureCode.F8, State.INVESTIGATING).transition)

    def test_19_f9_maps_to_escalated(self) -> None:
        self.assertEqual(State.ESCALATED, self.record(FailureCode.F9, State.IMPLEMENTING).transition)

    def test_20_actionable_f10_maps_to_needs_fix(self) -> None:
        record = self.record(FailureCode.F10, State.REVIEWING, actionable=True)
        self.assertEqual(FailureCode.F10, record.code)
        self.assertEqual(State.NEEDS_FIX, record.transition)

    def test_21_non_actionable_f10_is_reclassified_f8_and_escalated(self) -> None:
        record = self.record(FailureCode.F10, State.REVIEWING, actionable=False)
        self.assertEqual(FailureCode.F8, record.code)
        self.assertEqual(State.ESCALATED, record.transition)
        self.assertIn(FailureCode.F10.value, record.related_failures)

    def test_22_f11_valid_rejection_maps_to_codex_rejected(self) -> None:
        record = self.record(FailureCode.F11, State.READY_FOR_CODEX_REVIEW, codex_result="valid_rejection")
        self.assertEqual(State.CODEX_REJECTED, record.transition)

    def test_23_f11_invalid_result_maps_to_escalated(self) -> None:
        record = self.record(FailureCode.F11, State.READY_FOR_CODEX_REVIEW, codex_result="invalid_result")
        self.assertEqual(State.ESCALATED, record.transition)


class AntiLoopTests(unittest.TestCase):
    def new_cycle(self, guard: AntiLoopGuard | None = None):
        guard = guard or AntiLoopGuard()
        cycle = guard.start_cycle(
            run_id="run-loop",
            cycle_id=1,
            hypothesis_id="hypothesis-1",
            session_id="session-1",
            evidence_refs=("evidence-1",),
        )
        return guard, cycle

    def test_24_first_corrective_attempt_is_allowed(self) -> None:
        guard, cycle = self.new_cycle()
        receipt = guard.register_action(
            cycle,
            model_id="synthetic-model",
            corrective_role="implementer",
            action_kind=ActionKind.CORRECTIVE,
        )
        self.assertTrue(receipt.corrective_attempt_consumed)
        self.assertEqual(1, guard.corrective_attempt_count)

    def test_25_second_corrective_attempt_same_key_is_rejected(self) -> None:
        guard, cycle = self.new_cycle()
        arguments = {
            "model_id": "synthetic-model",
            "corrective_role": "implementer",
            "action_kind": ActionKind.CORRECTIVE,
        }
        guard.register_action(cycle, **arguments)
        with self.assertRaises(DuplicateCorrectiveAttempt):
            guard.register_action(cycle, **arguments)

    def test_26_retry_in_same_cycle_is_rejected(self) -> None:
        guard, _ = self.new_cycle()
        with self.assertRaises(CycleSequenceError):
            guard.start_cycle(
                run_id="run-loop",
                cycle_id=1,
                hypothesis_id="hypothesis-1",
                session_id="session-other",
                evidence_refs=("evidence-2",),
            )

    def test_27_retry_in_same_session_is_rejected(self) -> None:
        guard, cycle = self.new_cycle()
        guard.finish_cycle(cycle, CycleOutcome.FAILED)
        with self.assertRaises(SessionReuseError):
            guard.start_cycle(
                run_id="run-loop",
                cycle_id=2,
                hypothesis_id="hypothesis-1",
                session_id="session-1",
                evidence_refs=("evidence-2",),
            )

    def test_28_cycle_two_with_new_evidence_is_allowed(self) -> None:
        guard, cycle = self.new_cycle()
        guard.finish_cycle(cycle, CycleOutcome.FAILED)
        cycle_two = guard.start_cycle(
            run_id="run-loop",
            cycle_id=2,
            hypothesis_id="hypothesis-1",
            session_id="session-2",
            evidence_refs=("evidence-2",),
        )
        self.assertEqual(2, cycle_two.cycle_id)
        self.assertEqual("session-2", cycle_two.session_id)

    def test_29_cycle_two_without_new_evidence_is_rejected(self) -> None:
        guard, cycle = self.new_cycle()
        guard.finish_cycle(cycle, CycleOutcome.FAILED)
        with self.assertRaises(NewEvidenceRequired):
            guard.start_cycle(
                run_id="run-loop",
                cycle_id=2,
                hypothesis_id="hypothesis-1",
                session_id="session-2",
                evidence_refs=("evidence-1",),
            )

    def test_30_third_cycle_is_allowed(self) -> None:
        guard, cycle_one = self.new_cycle()
        guard.finish_cycle(cycle_one, CycleOutcome.FAILED)
        cycle_two = guard.start_cycle(
            run_id="run-loop",
            cycle_id=2,
            hypothesis_id="hypothesis-1",
            session_id="session-2",
            evidence_refs=("evidence-2",),
        )
        guard.finish_cycle(cycle_two, CycleOutcome.FAILED)
        cycle_three = guard.start_cycle(
            run_id="run-loop",
            cycle_id=3,
            hypothesis_id="hypothesis-1",
            session_id="session-3",
            evidence_refs=("evidence-3",),
        )
        self.assertEqual(3, cycle_three.cycle_id)

    def test_31_failed_third_cycle_and_later_attempt_escalate(self) -> None:
        guard, cycle_one = self.new_cycle()
        guard.finish_cycle(cycle_one, CycleOutcome.FAILED)
        cycle_two = guard.start_cycle(
            run_id="run-loop",
            cycle_id=2,
            hypothesis_id="hypothesis-1",
            session_id="session-2",
            evidence_refs=("evidence-2",),
        )
        guard.finish_cycle(cycle_two, CycleOutcome.FAILED)
        cycle_three = guard.start_cycle(
            run_id="run-loop",
            cycle_id=3,
            hypothesis_id="hypothesis-1",
            session_id="session-3",
            evidence_refs=("evidence-3",),
        )
        self.assertEqual(CycleDecision.ESCALATED, guard.finish_cycle(cycle_three, CycleOutcome.FAILED))
        with self.assertRaises(CycleLimitEscalation) as captured:
            guard.start_cycle(
                run_id="run-loop",
                cycle_id=4,
                hypothesis_id="hypothesis-1",
                session_id="session-4",
                evidence_refs=("evidence-4",),
            )
        self.assertEqual(State.ESCALATED, captured.exception.transition)

    def test_32_read_only_action_does_not_consume_attempt(self) -> None:
        guard, cycle = self.new_cycle()
        receipt = guard.register_action(
            cycle,
            model_id="synthetic-model",
            corrective_role="investigator",
            action_kind=ActionKind.READ_ONLY,
        )
        self.assertFalse(receipt.corrective_attempt_consumed)
        self.assertEqual(0, guard.corrective_attempt_count)

    def test_33_non_corrective_test_does_not_consume_attempt(self) -> None:
        guard, cycle = self.new_cycle()
        receipt = guard.register_action(
            cycle,
            model_id="synthetic-model",
            corrective_role="tester",
            action_kind=ActionKind.TEST,
        )
        self.assertFalse(receipt.corrective_attempt_consumed)
        self.assertEqual(0, guard.corrective_attempt_count)

    def test_34_non_corrective_review_does_not_consume_attempt(self) -> None:
        guard, cycle = self.new_cycle()
        receipt = guard.register_action(
            cycle,
            model_id="synthetic-model",
            corrective_role="reviewer",
            action_kind=ActionKind.REVIEW,
        )
        self.assertFalse(receipt.corrective_attempt_consumed)
        self.assertEqual(0, guard.corrective_attempt_count)

    def test_35_resource_blocked_action_does_not_consume_attempt(self) -> None:
        guard, cycle = self.new_cycle()
        receipt = guard.register_action(
            cycle,
            model_id="synthetic-model",
            corrective_role="resource-checker",
            action_kind=ActionKind.RESOURCE_CHECK,
        )
        decision = guard.finish_cycle(cycle, CycleOutcome.RESOURCE_BLOCKED)
        self.assertFalse(receipt.corrective_attempt_consumed)
        self.assertEqual(CycleDecision.RESOURCE_BLOCKED, decision)
        self.assertEqual(0, guard.corrective_attempt_count)


if __name__ == "__main__":
    unittest.main()
