"""Serializable impact analysis consumed by risk and dependency contracts."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


IMPACT_FIELDS = frozenset(
    {
        "reads",
        "writes",
        "dom_affected",
        "state_affected",
        "storage_affected",
        "domain_invariants",
        "cross_module_impact",
    }
)


class ImpactAnalysisError(ValueError):
    pass


def _items(value: Any, field: str) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        raise ImpactAnalysisError(f"{field} must be a list")
    result = tuple(value)
    if any(not isinstance(item, str) or not item.strip() for item in result):
        raise ImpactAnalysisError(f"{field} entries must be non-empty strings")
    if len(set(result)) != len(result):
        raise ImpactAnalysisError(f"{field} contains duplicates")
    return result


@dataclass(frozen=True)
class ImpactAnalysis:
    reads: tuple[str, ...]
    writes: tuple[str, ...]
    dom_affected: tuple[str, ...]
    state_affected: tuple[str, ...]
    storage_affected: tuple[str, ...]
    domain_invariants: tuple[str, ...]
    cross_module_impact: tuple[str, ...]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ImpactAnalysis":
        if not isinstance(value, dict) or set(value) != IMPACT_FIELDS:
            raise ImpactAnalysisError("Impact Analysis requires its exact field set")
        return cls(**{field: _items(value[field], field) for field in IMPACT_FIELDS})

    def to_dict(self) -> dict[str, list[str]]:
        return {field: list(value) for field, value in asdict(self).items()}

    @property
    def all_terms(self) -> tuple[str, ...]:
        result: list[str] = []
        for value in asdict(self).values():
            result.extend(value)
        return tuple(result)
