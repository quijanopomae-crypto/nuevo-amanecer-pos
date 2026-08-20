"""Minimal append-only metrics with non-evaluable infrastructure failures."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Iterable, Mapping

from orchestrator.io_atomic import append_durable_line, canonical_json_bytes


class ModelFit(str, Enum):
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    EFFICIENT = "EFFICIENT"
    ACCEPTABLE = "ACCEPTABLE"
    LIMITED = "LIMITED"
    POOR_FIT = "POOR_FIT"
    NOT_EVALUABLE = "NOT_EVALUABLE"


NON_EVALUABLE_FAILURES = frozenset(
    {"RESOURCE_LIMIT", "PROVIDER_FAILURE", "EXTERNAL_DEPENDENCY"}
)
METRIC_FIELDS = frozenset(
    {
        "TASK_TYPE",
        "MODEL",
        "RESULT",
        "ROOT_CAUSE_FOUND",
        "TEST_PASS",
        "REGRESSION",
        "ESCALATED_TO",
        "DURATION",
        "FAILURE_CLASS",
        "CYCLES",
        "RESUMED_AFTER_CRASH",
    }
)


@dataclass(frozen=True)
class MetricRecord:
    task_type: str
    model: str
    result: str
    root_cause_found: bool
    test_pass: bool
    regression: bool
    escalated_to: str | None
    duration: float
    failure_class: str | None
    cycles: int
    resumed_after_crash: bool

    def __post_init__(self) -> None:
        if any(
            not isinstance(value, str) or not value.strip()
            for value in (self.task_type, self.model, self.result)
        ):
            raise ValueError("task_type, model and result are required")
        if any(
            type(value) is not bool
            for value in (
                self.root_cause_found,
                self.test_pass,
                self.regression,
                self.resumed_after_crash,
            )
        ):
            raise ValueError("metric boolean fields require booleans")
        for field, value in (
            ("escalated_to", self.escalated_to),
            ("failure_class", self.failure_class),
        ):
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise ValueError(f"{field} must be null or a non-empty string")
        if (
            isinstance(self.duration, bool)
            or not isinstance(self.duration, (int, float))
            or not math.isfinite(self.duration)
            or self.duration < 0
        ):
            raise ValueError("duration must be non-negative")
        if isinstance(self.cycles, bool) or not isinstance(self.cycles, int) or self.cycles < 1:
            raise ValueError("cycles must be positive")

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "MetricRecord":
        if not isinstance(value, dict) or set(value) != METRIC_FIELDS:
            raise ValueError("metric has unknown or missing fields")
        return cls(
            task_type=value["TASK_TYPE"],
            model=value["MODEL"],
            result=value["RESULT"],
            root_cause_found=value["ROOT_CAUSE_FOUND"],
            test_pass=value["TEST_PASS"],
            regression=value["REGRESSION"],
            escalated_to=value["ESCALATED_TO"],
            duration=value["DURATION"],
            failure_class=value["FAILURE_CLASS"],
            cycles=value["CYCLES"],
            resumed_after_crash=value["RESUMED_AFTER_CRASH"],
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "TASK_TYPE": self.task_type,
            "MODEL": self.model,
            "RESULT": self.result,
            "ROOT_CAUSE_FOUND": self.root_cause_found,
            "TEST_PASS": self.test_pass,
            "REGRESSION": self.regression,
            "ESCALATED_TO": self.escalated_to,
            "DURATION": self.duration,
            "FAILURE_CLASS": self.failure_class,
            "CYCLES": self.cycles,
            "RESUMED_AFTER_CRASH": self.resumed_after_crash,
        }

    @property
    def evaluation(self) -> ModelFit | None:
        if self.failure_class in NON_EVALUABLE_FAILURES:
            return ModelFit.NOT_EVALUABLE
        return None


def classify_model(records: Iterable[MetricRecord]) -> ModelFit:
    records = tuple(record for record in records if record.evaluation is not ModelFit.NOT_EVALUABLE)
    if len(records) < 3:
        return ModelFit.INSUFFICIENT_DATA
    success_rate = sum(record.test_pass and not record.regression for record in records) / len(records)
    average_cycles = sum(record.cycles for record in records) / len(records)
    if success_rate >= 0.9 and average_cycles <= 1.5:
        return ModelFit.EFFICIENT
    if success_rate >= 0.75:
        return ModelFit.ACCEPTABLE
    if success_rate >= 0.5:
        return ModelFit.LIMITED
    return ModelFit.POOR_FIT


class MetricsLedger:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def append(self, record: MetricRecord) -> None:
        append_durable_line(self.path, canonical_json_bytes(record.to_dict()) + b"\n")

    def load(self) -> tuple[MetricRecord, ...]:
        try:
            payload = self.path.read_bytes()
        except OSError as exc:
            raise ValueError(f"metrics unreadable: {exc}") from exc
        if payload and not payload.endswith(b"\n"):
            raise ValueError("metrics log is partially written")
        result: list[MetricRecord] = []
        for index, line in enumerate(payload.splitlines(), start=1):
            try:
                value = json.loads(line)
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise ValueError(f"invalid metrics JSON at line {index}") from exc
            result.append(MetricRecord.from_dict(value))
        return tuple(result)
