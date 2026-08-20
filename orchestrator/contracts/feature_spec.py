"""Minimal validated Feature Spec contract."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import PurePosixPath
from typing import Any, Mapping


FEATURE_SPEC_FIELDS = frozenset(
    {
        "objective",
        "in_scope",
        "out_of_scope",
        "acceptance_criteria",
        "invariants",
        "expected_files",
        "forbidden_files",
    }
)


class FeatureSpecError(ValueError):
    pass


def _strings(value: Any, field: str, *, required: bool = False) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        raise FeatureSpecError(f"{field} must be a list")
    result = tuple(value)
    if required and not result:
        raise FeatureSpecError(f"{field} cannot be empty")
    if any(not isinstance(item, str) or not item.strip() for item in result):
        raise FeatureSpecError(f"{field} entries must be non-empty strings")
    if len(set(result)) != len(result):
        raise FeatureSpecError(f"{field} contains duplicates")
    return result


def _relative_paths(value: Any, field: str) -> tuple[str, ...]:
    result = _strings(value, field)
    for raw in result:
        path = PurePosixPath(raw)
        if "\\" in raw or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
            raise FeatureSpecError(f"{field} contains unsafe path: {raw}")
    return result


@dataclass(frozen=True)
class FeatureSpec:
    objective: str
    in_scope: tuple[str, ...]
    out_of_scope: tuple[str, ...]
    acceptance_criteria: tuple[str, ...]
    invariants: tuple[str, ...]
    expected_files: tuple[str, ...]
    forbidden_files: tuple[str, ...]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "FeatureSpec":
        if not isinstance(value, dict) or set(value) != FEATURE_SPEC_FIELDS:
            raise FeatureSpecError("Feature Spec requires its exact field set")
        objective = value["objective"]
        if not isinstance(objective, str) or not objective.strip():
            raise FeatureSpecError("objective must be a non-empty string")
        spec = cls(
            objective=objective.strip(),
            in_scope=_strings(value["in_scope"], "in_scope", required=True),
            out_of_scope=_strings(value["out_of_scope"], "out_of_scope"),
            acceptance_criteria=_strings(
                value["acceptance_criteria"], "acceptance_criteria", required=True
            ),
            invariants=_strings(value["invariants"], "invariants", required=True),
            expected_files=_relative_paths(value["expected_files"], "expected_files"),
            forbidden_files=_relative_paths(value["forbidden_files"], "forbidden_files"),
        )
        if set(spec.in_scope) & set(spec.out_of_scope):
            raise FeatureSpecError("in_scope and out_of_scope overlap")
        if set(spec.expected_files) & set(spec.forbidden_files):
            raise FeatureSpecError("expected_files and forbidden_files overlap")
        return spec

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        for field in FEATURE_SPEC_FIELDS - {"objective"}:
            value[field] = list(value[field])
        return value
