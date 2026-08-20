"""Pure policy gate for an external Codex App handoff."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from orchestrator.contracts.risk_classifier import RiskLevel


class CodexDecision(str, Enum):
    ADMIT = "ADMIT"
    DENY = "DENY"
    NOT_REQUIRED = "NOT_REQUIRED"


DENIED_FAILURES = frozenset(
    {"RESOURCE_LIMIT", "PROVIDER_FAILURE", "EXTERNAL_DEPENDENCY", "TOOL_FAILURE"}
)
CRITICAL_TOPICS = frozenset(
    {
        "integridad financiera",
        "corrupción de datos",
        "persistencia crítica",
        "seguridad",
        "arquitectura compartida crítica",
    }
)


@dataclass(frozen=True)
class CodexAdmissionContext:
    risk: RiskLevel
    failure_class: str | None
    topics: tuple[str, ...] = ()
    deepseek_glm_exhausted: bool = False
    high_value_code_failure: bool = False
    release_gate: bool = False
    cosmetic: bool = False


@dataclass(frozen=True)
class CodexAdmissionResult:
    decision: CodexDecision
    reasons: tuple[str, ...]


class CodexAdmissionGate:
    @staticmethod
    def decide(context: CodexAdmissionContext) -> CodexAdmissionResult:
        if context.failure_class in DENIED_FAILURES:
            return CodexAdmissionResult(CodexDecision.DENY, (context.failure_class,))
        if context.cosmetic:
            return CodexAdmissionResult(CodexDecision.DENY, ("COSMETIC",))
        topics = {topic.casefold() for topic in context.topics}
        critical_topics = tuple(sorted(topics & CRITICAL_TOPICS))
        reasons: list[str] = list(critical_topics)
        if context.release_gate:
            reasons.append("RELEASE_GATE")
        if context.risk in {RiskLevel.HIGH, RiskLevel.CRITICAL}:
            reasons.append(f"RISK_{context.risk.value}")
        if context.deepseek_glm_exhausted and context.high_value_code_failure:
            reasons.append("PRIMARY_AND_CONDITIONAL_REVIEW_EXHAUSTED")
        if reasons:
            return CodexAdmissionResult(CodexDecision.ADMIT, tuple(reasons))
        return CodexAdmissionResult(CodexDecision.NOT_REQUIRED, ("NO_ADMISSION_TRIGGER",))
