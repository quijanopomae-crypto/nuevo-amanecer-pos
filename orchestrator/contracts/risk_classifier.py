"""Declarative risk classifier for orchestrator gates."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .feature_spec import FeatureSpec
from .impact_analysis import ImpactAnalysis


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


CRITICAL_DOMAINS = frozenset(
    {
        "ventas",
        "venta",
        "inventario",
        "stock",
        "caja",
        "créditos",
        "creditos",
        "persistencia",
        "seguridad",
        "backup",
        "restore",
        "datos durables",
    }
)


@dataclass(frozen=True)
class RiskAssessment:
    level: RiskLevel
    reasons: tuple[str, ...]
    codex_review_required: bool
    adversarial_tests_required: bool

    def to_dict(self) -> dict[str, object]:
        return {
            "level": self.level.value,
            "reasons": list(self.reasons),
            "codex_review_required": self.codex_review_required,
            "adversarial_tests_required": self.adversarial_tests_required,
        }


class RiskClassifier:
    @staticmethod
    def classify(spec: FeatureSpec, impact: ImpactAnalysis) -> RiskAssessment:
        terms = tuple(term.casefold() for term in impact.all_terms)
        matched = tuple(
            sorted(domain for domain in CRITICAL_DOMAINS if any(domain in term for term in terms))
        )
        critical_write = any(
            any(domain in term.casefold() for domain in CRITICAL_DOMAINS)
            for term in (*impact.writes, *impact.storage_affected, *impact.domain_invariants)
        )
        if critical_write:
            level = RiskLevel.CRITICAL
        elif matched:
            level = RiskLevel.HIGH
        elif impact.writes or impact.cross_module_impact or spec.expected_files:
            level = RiskLevel.MEDIUM
        else:
            level = RiskLevel.LOW
        reasons = matched or (("cross-module-or-write-impact",) if level is RiskLevel.MEDIUM else ("read-only-local",))
        return RiskAssessment(
            level=level,
            reasons=reasons,
            codex_review_required=level in {RiskLevel.HIGH, RiskLevel.CRITICAL},
            adversarial_tests_required=level in {RiskLevel.HIGH, RiskLevel.CRITICAL},
        )
