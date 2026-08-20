"""Versioned infrastructure regression comparison without product exceptions in code."""

from __future__ import annotations

import json
import hashlib
import subprocess
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any


class RegressionClassification(str, Enum):
    PASS = "PASS"
    BASELINE_EXPECTED = "BASELINE_EXPECTED"
    NEW_REGRESSION = "NEW_REGRESSION"
    BLOCKED = "BLOCKED"


@dataclass(frozen=True)
class RegressionGateResult:
    classification: RegressionClassification
    reason: str
    pass_count: int | None
    fail_count: int | None
    total_count: int | None


def _load_json(path: Path, label: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{label} unreadable: {exc}") from exc


def _git_blob(root: Path, relative: str) -> str:
    completed = subprocess.run(
        ["git", "hash-object", "--", relative],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if completed.returncode != 0:
        raise ValueError(f"cannot hash {relative}: {completed.stderr.strip()}")
    return completed.stdout.strip()


def _git(root: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args], cwd=root, capture_output=True, text=True, encoding="utf-8"
    )
    if completed.returncode != 0:
        raise ValueError(f"git {' '.join(args)} failed: {completed.stderr.strip()}")
    return completed.stdout.strip()


def _failure_fingerprint(case: dict[str, Any]) -> dict[str, Any]:
    detail = case.get("detail")
    if not isinstance(detail, dict):
        raise ValueError("failure detail is missing")
    result = detail.get("result")
    if not isinstance(result, dict):
        raise ValueError("failure result is missing")
    error = result.get("error")
    if not isinstance(error, dict):
        raise ValueError("failure error is missing")
    before = detail.get("revisionAntes")
    after = detail.get("revisionDespues")
    revision_delta = None
    if before is not None or after is not None:
        if not isinstance(before, int) or not isinstance(after, int):
            raise ValueError("revision effect is malformed")
        revision_delta = after - before
    return {
        "n": case.get("n"),
        "name": case.get("name"),
        "observed_status": result.get("status"),
        "error_code": error.get("code"),
        "gastos_con_operacion": detail.get("gastosConOp"),
        "movimientos_con_operacion": detail.get("movsConOp"),
        "revision_delta": revision_delta,
    }


def compare_cash_baseline(
    root: Path,
    candidate_report: Path,
    baseline_path: Path | None = None,
) -> RegressionGateResult:
    root = Path(root).resolve()
    baseline_path = baseline_path or root / "infra" / "stable" / "baselines" / "cash-v10-migration-base.json"
    try:
        baseline = _load_json(baseline_path, "CASH baseline")
        if not isinstance(baseline, dict) or baseline.get("schema") != "infra-regression-baseline@1":
            raise ValueError("invalid CASH baseline schema")
        base_commit = baseline["base_commit"]
        if _git(root, "rev-parse", f"{base_commit}^{{commit}}") != base_commit:
            raise ValueError("CASH baseline commit is not an exact existing commit")
        _git(root, "merge-base", "--is-ancestor", base_commit, "HEAD")
        report = _load_json(Path(candidate_report), "fresh CASH candidate report")
        if not isinstance(report, list) or len(report) != baseline["runs_required"]:
            raise ValueError("CASH report run count is not comparable")
        for group in (baseline["product_blobs"], baseline["harness_blobs"]):
            for relative, expected_blob in group.items():
                if _git(root, "rev-parse", f"{base_commit}:{relative}") != expected_blob:
                    raise ValueError(f"versioned baseline blob does not belong to base commit: {relative}")
                if _git_blob(root, relative) != expected_blob:
                    return RegressionGateResult(
                        RegressionClassification.NEW_REGRESSION,
                        f"protected product or harness blob changed: {relative}",
                        None,
                        None,
                        None,
                    )
        expected = baseline["expected"]
        expected_failures = expected["failures"]
        product_path = next(iter(baseline["product_blobs"]))
        product_bytes = (root / product_path).read_bytes()
        expected_source_hash = "sha256:" + hashlib.sha256(product_bytes).hexdigest()
        expected_source_length = len(product_bytes.decode("utf-8").encode("utf-16-le")) // 2
        observed_counts: set[tuple[int, int, int]] = set()
        for run_index, item in enumerate(report):
            if not isinstance(item, dict) or item.get("run") != run_index:
                raise ValueError("CASH run identity/order is not comparable")
            run = item.get("report") if isinstance(item, dict) else None
            cases = run.get("cases") if isinstance(run, dict) else None
            if not isinstance(cases, list):
                raise ValueError("CASH cases are missing")
            source = run.get("source")
            if not isinstance(source, dict) or source.get("hash") != expected_source_hash:
                raise ValueError("CASH candidate report is not bound to current product hash")
            if source.get("length") != expected_source_length:
                raise ValueError("CASH candidate report is not bound to current product length")
            chrome_version = run.get("chromeVersion")
            if (
                run.get("executionMode") != "autorun"
                or not isinstance(chrome_version, str)
                or not chrome_version.strip()
            ):
                raise ValueError("CASH candidate report lacks real autorun/Chrome evidence")
            passed = sum(case.get("status") == "PASS" for case in cases if isinstance(case, dict))
            failures = [case for case in cases if isinstance(case, dict) and case.get("status") == "FAIL"]
            other = [case for case in cases if not isinstance(case, dict) or case.get("status") not in {"PASS", "FAIL"}]
            if other:
                raise ValueError("CASH case status is not comparable")
            if (run.get("pass"), run.get("fail"), run.get("total")) != (
                passed,
                len(failures),
                len(cases),
            ):
                raise ValueError("CASH report declared counts differ from executed cases")
            expected_status = "PASS" if not failures else "FAIL"
            if run.get("status") != expected_status:
                raise ValueError("CASH report status differs from executed cases")
            observed_counts.add((passed, len(failures), len(cases)))
            if [_failure_fingerprint(case) for case in failures] != expected_failures:
                return RegressionGateResult(
                    RegressionClassification.NEW_REGRESSION,
                    "CASH failure type or effect differs from versioned baseline",
                    passed,
                    len(failures),
                    len(cases),
                )
        if len(observed_counts) != 1:
            return RegressionGateResult(
                RegressionClassification.NEW_REGRESSION,
                "CASH runs disagree with each other",
                None,
                None,
                None,
            )
        passed, failed, total = observed_counts.pop()
        expected_counts = (expected["pass"], expected["fail"], expected["total"])
        if (passed, failed, total) != expected_counts:
            return RegressionGateResult(
                RegressionClassification.NEW_REGRESSION,
                "CASH counts differ from versioned baseline",
                passed,
                failed,
                total,
            )
        classification = (
            RegressionClassification.PASS
            if expected["fail"] == 0
            else RegressionClassification.BASELINE_EXPECTED
        )
        return RegressionGateResult(
            classification,
            "candidate exactly matches explicit versioned CASH baseline",
            passed,
            failed,
            total,
        )
    except (KeyError, TypeError, ValueError) as exc:
        return RegressionGateResult(RegressionClassification.BLOCKED, str(exc), None, None, None)
