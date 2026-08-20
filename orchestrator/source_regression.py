"""Offline verification and execution of the exact source regression Git bundle."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


class SourceRegressionError(ValueError):
    pass


@dataclass(frozen=True)
class SourceRegressionResult:
    methods: int
    passed: int
    failed: int
    blocked: int
    command: str
    source_commit: str
    source_tree: str


def _run(args: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    if check and completed.returncode != 0:
        raise SourceRegressionError(
            f"command failed ({completed.returncode}): {' '.join(args)}\n{completed.stdout}{completed.stderr}"
        )
    return completed


def _git(cwd: Path, *args: str) -> str:
    return _run(["git", *args], cwd).stdout.strip()


def _tree_blobs(cwd: Path, commit: str) -> dict[str, str]:
    result: dict[str, str] = {}
    output = _git(cwd, "ls-tree", "-r", commit)
    for line in output.splitlines():
        metadata, path = line.split("\t", 1)
        _mode, object_type, object_id = metadata.split(" ", 2)
        if object_type == "blob":
            result[path] = object_id
    return result


def _load_metadata(root: Path, metadata_path: Path | None = None) -> dict[str, Any]:
    path = metadata_path or root / "infra" / "stable" / "source" / "SOURCE_REGRESSION.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SourceRegressionError(f"source metadata unreadable: {exc}") from exc
    if not isinstance(value, dict) or value.get("schema") != "source-regression@1":
        raise SourceRegressionError("invalid source regression metadata")
    return value


def verify_source_provenance(root: Path, metadata_path: Path | None = None) -> dict[str, Any]:
    root = Path(root).resolve()
    metadata = _load_metadata(root, metadata_path)
    bundle = root / metadata["bundle"]
    try:
        bundle_digest = "sha256:" + hashlib.sha256(bundle.read_bytes()).hexdigest()
    except OSError as exc:
        raise SourceRegressionError(f"source bundle unreadable: {exc}") from exc
    if bundle_digest != metadata["bundle_sha256"]:
        raise SourceRegressionError("source bundle digest mismatch")
    _run(["git", "bundle", "verify", str(bundle)], root)
    with tempfile.TemporaryDirectory(prefix="pos-source-provenance-") as temporary:
        checkout = Path(temporary) / "source"
        _run(["git", "clone", "--quiet", str(bundle), str(checkout)], root)
        commit = metadata["source_commit"]
        try:
            _git(checkout, "cat-file", "-e", f"{commit}^{{commit}}")
        except SourceRegressionError as exc:
            raise SourceRegressionError("declared source commit does not exist in bundle") from exc
        if _git(checkout, "rev-parse", f"{commit}^{{tree}}") != metadata["source_tree"]:
            raise SourceRegressionError("source tree mismatch")
        if _git(checkout, "rev-parse", f"{commit}:tests/infrastructure") != metadata["source_suite_tree"]:
            raise SourceRegressionError("source suite tree mismatch")
        manifest_text = _git(checkout, "show", f"{commit}:MANIFEST.yaml")
        manifest = yaml.safe_load(manifest_text)
        if manifest.get("metadata", {}).get("name") != metadata["source_repository"]:
            raise SourceRegressionError("source repository identity is not committed in source tree")
        for path, expected_blob in metadata["source_test_blobs"].items():
            if _git(checkout, "rev-parse", f"{commit}:{path}") != expected_blob:
                raise SourceRegressionError(f"source test blob mismatch: {path}")
        promotion_commit = metadata["promotion_commit"]
        _git(root, "cat-file", "-e", f"{promotion_commit}^{{commit}}")
        source_blobs = _tree_blobs(checkout, commit)
        promotion_blobs = _tree_blobs(root, promotion_commit)
        exact_promoted_blobs = {
            path: source_blob
            for path, source_blob in source_blobs.items()
            if promotion_blobs.get(path) == source_blob
        }
        if metadata["promoted_blobs"] != exact_promoted_blobs:
            raise SourceRegressionError("promoted_blobs is not the exhaustive exact source/promotion intersection")
        for path, expected_blob in metadata["promoted_blobs"].items():
            source_blob = _git(checkout, "rev-parse", f"{commit}:{path}")
            promoted_blob = _git(root, "rev-parse", f"{promotion_commit}:{path}")
            if source_blob != expected_blob or promoted_blob != expected_blob:
                raise SourceRegressionError(f"promoted content does not correspond to source: {path}")
    return metadata


def run_source_regression(root: Path, metadata_path: Path | None = None) -> SourceRegressionResult:
    root = Path(root).resolve()
    metadata = verify_source_provenance(root, metadata_path)
    bundle = root / metadata["bundle"]
    with tempfile.TemporaryDirectory(prefix="pos-source-regression-") as temporary:
        checkout = Path(temporary) / "source"
        _run(["git", "clone", "--quiet", str(bundle), str(checkout)], root)
        _run(["git", "checkout", "--quiet", "--detach", metadata["source_commit"]], checkout)
        completed = _run(
            [
                sys.executable,
                "-B",
                "-m",
                "unittest",
                "discover",
                "-s",
                "tests/infrastructure",
                "-p",
                "test_*.py",
                "-v",
            ],
            checkout,
            check=False,
        )
        output = completed.stdout + completed.stderr
        match = re.search(r"Ran (\d+) tests?", output)
        if completed.returncode != 0 or match is None:
            raise SourceRegressionError(f"source regression failed\n{output}")
        methods = int(match.group(1))
        if methods != metadata["methods"]:
            raise SourceRegressionError(
                f"source method count mismatch: expected {metadata['methods']}, observed {methods}"
            )
        return SourceRegressionResult(
            methods=methods,
            passed=methods,
            failed=0,
            blocked=0,
            command=metadata["command"],
            source_commit=metadata["source_commit"],
            source_tree=metadata["source_tree"],
        )
