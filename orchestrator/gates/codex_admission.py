"""Pure policy gate for an external Codex App handoff."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any, Mapping

from orchestrator.contracts.risk_classifier import RiskLevel


class CodexDecision(str, Enum):
    ADMIT = "ADMIT"
    DENY = "DENY"
    NOT_REQUIRED = "NOT_REQUIRED"


@dataclass(frozen=True)
class CodexAdmissionContext:
    risk: RiskLevel
    failure_class: str | None
    topics: tuple[str, ...] = ()
    prior_engineering_review_exhausted: bool = False
    high_value_code_failure: bool = False
    release_gate: bool = False
    cosmetic: bool = False


@dataclass(frozen=True)
class CodexAdmissionResult:
    decision: CodexDecision
    reasons: tuple[str, ...]


class CodexAdmissionGate:
    @staticmethod
    def decide(
        context: CodexAdmissionContext,
        policy: Mapping[str, Any],
    ) -> CodexAdmissionResult:
        denied_failures = frozenset(policy["denied_failure_classes"])
        critical_topics_policy = frozenset(topic.casefold() for topic in policy["critical_topics"])
        admitted_risks = frozenset(policy["risks"])
        if context.failure_class in denied_failures:
            return CodexAdmissionResult(CodexDecision.DENY, (context.failure_class,))
        if context.cosmetic and policy["deny_cosmetic"]:
            return CodexAdmissionResult(CodexDecision.DENY, ("COSMETIC",))
        topics = {topic.casefold() for topic in context.topics}
        critical_topics = tuple(sorted(topics & critical_topics_policy))
        reasons: list[str] = list(critical_topics)
        if context.release_gate and policy["admit_on_release_gate"]:
            reasons.append("RELEASE_GATE")
        if context.risk.value in admitted_risks:
            reasons.append(f"RISK_{context.risk.value}")
        if (
            context.prior_engineering_review_exhausted
            and context.high_value_code_failure
            and policy["admit_after_review_exhausted"]
        ):
            reasons.append("PRIMARY_AND_CONDITIONAL_REVIEW_EXHAUSTED")
        if reasons:
            return CodexAdmissionResult(CodexDecision.ADMIT, tuple(reasons))
        return CodexAdmissionResult(CodexDecision.NOT_REQUIRED, ("NO_ADMISSION_TRIGGER",))
