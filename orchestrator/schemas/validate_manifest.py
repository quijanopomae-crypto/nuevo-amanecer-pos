#!/usr/bin/env python3
"""Strict, dependency-light validator for Orchestrator V1 RC1 MANIFEST.yaml."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Mapping

import yaml


SCHEMA_ID = "nuevo-amanecer.orchestrator/manifest@1.0.0-rc1"
OPEN_CODE_VERSION = "1.18.18"
CANONICAL_SKILLS = ".agents/skills"
FORBIDDEN_SKILLS = ".opencode/skills"
CANONICALIZATION = "rfc8785-jcs-subset-v1"
ALLOWED_VARIABLES = (
    "MANIFEST_DIR",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "PWD",
)
ALLOWED_PATH_ROOTS = (
    "orchestrator",
    ".agents",
    ".opencode",
    "tests",
    "fixtures",
    "evidence",
)
PATH_FIELDS = (
    "schemas",
    "state",
    "policies",
    "skills",
    "agents",
    "commands",
    "tools",
    "tests",
    "fixtures",
    "evidence",
)
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
VARIABLE_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
DIGEST_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
WINDOWS_ABSOLUTE_PATTERN = re.compile(r"^[A-Za-z]:[/\\]")


class ManifestValidationError(Exception):
    """A stable, machine-readable manifest validation failure."""

    def __init__(self, code: str, path: str, message: str) -> None:
        self.code = code
        self.path = path
        self.message = message
        super().__init__(f"{code} at {path}: {message}")


class DuplicateKeyError(yaml.YAMLError):
    pass


class NoDuplicateSafeLoader(yaml.SafeLoader):
    pass


def _construct_mapping(loader: NoDuplicateSafeLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    result: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in result
        except TypeError as exc:
            raise DuplicateKeyError("unhashable YAML mapping key") from exc
        if duplicate:
            raise DuplicateKeyError(f"duplicate YAML key: {key!r}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


NoDuplicateSafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_mapping,
)


def _fail(code: str, path: str, message: str) -> None:
    raise ManifestValidationError(code, path, message)


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        _fail("INVALID_TYPE", path, "expected mapping")
    return value


def _strict_mapping(value: Any, path: str, required: Iterable[str]) -> Mapping[str, Any]:
    mapping = _mapping(value, path)
    required_set = set(required)
    keys = set(mapping.keys())
    unknown = sorted((repr(key) for key in keys - required_set))
    if unknown:
        _fail("UNKNOWN_PROPERTY", path, f"unknown properties: {', '.join(unknown)}")
    missing = sorted(required_set - keys)
    if missing:
        _fail("MISSING_PROPERTY", path, f"missing properties: {', '.join(missing)}")
    return mapping


def _string(value: Any, path: str, *, nonempty: bool = True) -> str:
    if not isinstance(value, str) or (nonempty and not value):
        _fail("INVALID_TYPE", path, "expected non-empty string" if nonempty else "expected string")
    return value


def _string_list(value: Any, path: str, *, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value):
        _fail("INVALID_TYPE", path, "expected string list")
    result: list[str] = []
    for index, item in enumerate(value):
        result.append(_string(item, f"{path}[{index}]"))
    return result


def _unique(values: Iterable[str], path: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            _fail("DUPLICATE_ID", path, f"duplicate identifier: {value}")
        seen.add(value)


def _identifier(value: Any, path: str) -> str:
    identifier = _string(value, path)
    if not ID_PATTERN.fullmatch(identifier):
        _fail("INVALID_ID", path, f"invalid identifier: {identifier}")
    return identifier


def _exact(value: Any, expected: Any, path: str, code: str = "INVALID_VALUE") -> None:
    if value != expected or type(value) is not type(expected):
        _fail(code, path, f"expected {expected!r}, observed {value!r}")


def _reject_floats(value: Any, path: str = "$") -> None:
    if isinstance(value, float):
        _fail("FLOAT_NOT_ALLOWED", path, "canonical manifest subset forbids floats")
    if isinstance(value, dict):
        for key, item in value.items():
            _reject_floats(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            _reject_floats(item, f"{path}[{index}]")


def _walk_strings(value: Any, path: str = "$") -> Iterable[tuple[str, str]]:
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _walk_strings(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _walk_strings(item, f"{path}[{index}]")


def _validate_variables(document: Mapping[str, Any]) -> None:
    allowed = set(ALLOWED_VARIABLES)
    for path, value in _walk_strings(document):
        for variable in VARIABLE_PATTERN.findall(value):
            if variable not in allowed:
                _fail("DISALLOWED_VARIABLE", path, f"environment variable is not allowed: {variable}")


def _validate_path(value: Any, path: str) -> str:
    raw = _string(value, path)
    if "\\" in raw:
        _fail("INVALID_PATH", path, "paths must use forward slashes")
    if raw.startswith(("/", "//")) or WINDOWS_ABSOLUTE_PATTERN.match(raw):
        _fail("INVALID_PATH", path, "absolute paths are forbidden")
    pure = PurePosixPath(raw)
    if not pure.parts or any(part in ("", ".", "..") for part in pure.parts):
        _fail("INVALID_PATH", path, "empty, dot and traversal segments are forbidden")
    if pure.parts[0] not in ALLOWED_PATH_ROOTS:
        _fail("DISALLOWED_PATH_ROOT", path, f"path root is not allowed: {pure.parts[0]}")
    return raw


def canonical_manifest_bytes(document: Mapping[str, Any]) -> bytes:
    """Return the normative RFC 8785-compatible subset used by RC1."""
    canonical = copy.deepcopy(dict(document))
    integrity = canonical.get("integrity")
    if isinstance(integrity, dict):
        integrity.pop("manifest_sha256", None)
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return encoded.encode("utf-8")


def compute_manifest_digest(document: Mapping[str, Any]) -> str:
    return "sha256:" + hashlib.sha256(canonical_manifest_bytes(document)).hexdigest()


def load_manifest(path: Path) -> Mapping[str, Any]:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        _fail("MANIFEST_READ_ERROR", "$", str(exc))
    try:
        document = yaml.load(text, Loader=NoDuplicateSafeLoader)
    except DuplicateKeyError as exc:
        _fail("DUPLICATE_KEY", "$", str(exc))
    except yaml.YAMLError as exc:
        _fail("INVALID_YAML", "$", str(exc))
    return _mapping(document, "$")


def _validate_named_mapping(
    value: Any,
    path: str,
    fields: Iterable[str],
) -> Mapping[str, Mapping[str, Any]]:
    mapping = _mapping(value, path)
    if not mapping:
        _fail("EMPTY_COLLECTION", path, "at least one entry is required")
    for identifier, item in mapping.items():
        _identifier(identifier, f"{path}.<id>")
        _strict_mapping(item, f"{path}.{identifier}", fields)
    return mapping


def validate_manifest(document: Mapping[str, Any], root: Path, *, verify_digest: bool = True) -> None:
    """Validate structure, references, paths, filesystem policy and digest."""
    top = _strict_mapping(
        document,
        "$",
        (
            "schema",
            "strict",
            "metadata",
            "runtime",
            "models",
            "capabilities",
            "roles",
            "workflow",
            "paths",
            "skills",
            "policies",
            "integrity",
        ),
    )
    _reject_floats(top)
    _validate_variables(top)
    _exact(top["schema"], SCHEMA_ID, "$.schema", "SCHEMA_MISMATCH")
    _exact(top["strict"], True, "$.strict", "STRICT_REQUIRED")

    metadata = _strict_mapping(top["metadata"], "$.metadata", ("name", "manifest_revision", "environment"))
    _identifier(metadata["name"], "$.metadata.name")
    revision = metadata["manifest_revision"]
    if isinstance(revision, bool) or not isinstance(revision, int) or revision <= 0:
        _fail("INVALID_MANIFEST_REVISION", "$.metadata.manifest_revision", "expected positive integer")
    environment = _string(metadata["environment"], "$.metadata.environment")
    if environment not in {"synthetic", "shadow"}:
        _fail("INVALID_ENVIRONMENT", "$.metadata.environment", environment)

    runtime = _strict_mapping(
        top["runtime"],
        "$.runtime",
        ("engine", "interface", "version", "skills_source", "forbidden_paths"),
    )
    _exact(runtime["engine"], "opencode", "$.runtime.engine")
    _exact(runtime["interface"], "desktop", "$.runtime.interface")
    version = _strict_mapping(runtime["version"], "$.runtime.version", ("policy", "value"))
    _exact(version["policy"], "exact", "$.runtime.version.policy")
    _exact(version["value"], OPEN_CODE_VERSION, "$.runtime.version.value")
    _exact(runtime["skills_source"], CANONICAL_SKILLS, "$.runtime.skills_source")
    forbidden_paths = _string_list(runtime["forbidden_paths"], "$.runtime.forbidden_paths")
    _unique(forbidden_paths, "$.runtime.forbidden_paths")
    _exact(forbidden_paths, [FORBIDDEN_SKILLS], "$.runtime.forbidden_paths")

    models = _validate_named_mapping(top["models"], "$.models", ("transport", "model_id", "variant"))
    for model_id, model in models.items():
        _string(model["transport"], f"$.models.{model_id}.transport")
        _string(model["model_id"], f"$.models.{model_id}.model_id")
        _string(model["variant"], f"$.models.{model_id}.variant")

    capabilities = _validate_named_mapping(top["capabilities"], "$.capabilities", ("kind",))
    for capability_id, capability in capabilities.items():
        kind = _string(capability["kind"], f"$.capabilities.{capability_id}.kind")
        if kind not in {"read", "write", "tests", "git"}:
            _fail("INVALID_CAPABILITY_KIND", f"$.capabilities.{capability_id}.kind", kind)

    roles = _validate_named_mapping(top["roles"], "$.roles", ("mode", "model_ref", "capabilities"))
    for role_id, role in roles.items():
        mode = _string(role["mode"], f"$.roles.{role_id}.mode")
        if mode not in {"primary", "worker", "reviewer", "external"}:
            _fail("INVALID_ROLE_MODE", f"$.roles.{role_id}.mode", mode)
        model_ref = _string(role["model_ref"], f"$.roles.{role_id}.model_ref")
        if model_ref not in models:
            _fail("UNKNOWN_MODEL_REFERENCE", f"$.roles.{role_id}.model_ref", model_ref)
        capability_refs = _string_list(role["capabilities"], f"$.roles.{role_id}.capabilities")
        _unique(capability_refs, f"$.roles.{role_id}.capabilities")
        for capability_ref in capability_refs:
            if capability_ref not in capabilities:
                _fail("UNKNOWN_CAPABILITY_REFERENCE", f"$.roles.{role_id}.capabilities", capability_ref)

    workflow = _strict_mapping(top["workflow"], "$.workflow", ("entry_role", "allowed_roles"))
    entry_role = _string(workflow["entry_role"], "$.workflow.entry_role")
    allowed_roles = _string_list(workflow["allowed_roles"], "$.workflow.allowed_roles", nonempty=True)
    _unique(allowed_roles, "$.workflow.allowed_roles")
    for role_ref in [entry_role, *allowed_roles]:
        if role_ref not in roles:
            _fail("UNKNOWN_ROLE_REFERENCE", "$.workflow", role_ref)
    if entry_role not in allowed_roles:
        _fail("ENTRY_ROLE_NOT_ALLOWED", "$.workflow.entry_role", entry_role)

    paths = _strict_mapping(top["paths"], "$.paths", PATH_FIELDS)
    normalized_paths = {field: _validate_path(paths[field], f"$.paths.{field}") for field in PATH_FIELDS}
    _exact(normalized_paths["skills"], CANONICAL_SKILLS, "$.paths.skills")

    skills = _strict_mapping(top["skills"], "$.skills", ("canonical_source", "required"))
    _exact(skills["canonical_source"], CANONICAL_SKILLS, "$.skills.canonical_source")
    required_skills = _string_list(skills["required"], "$.skills.required")
    _unique(required_skills, "$.skills.required")
    for index, skill_id in enumerate(required_skills):
        _identifier(skill_id, f"$.skills.required[{index}]")

    policies = _strict_mapping(
        top["policies"],
        "$.policies",
        ("unknown_properties", "duplicate_ids", "allowed_variables", "allowed_path_roots"),
    )
    _exact(policies["unknown_properties"], "reject", "$.policies.unknown_properties")
    _exact(policies["duplicate_ids"], "reject", "$.policies.duplicate_ids")
    policy_variables = _string_list(policies["allowed_variables"], "$.policies.allowed_variables")
    policy_roots = _string_list(policies["allowed_path_roots"], "$.policies.allowed_path_roots")
    _unique(policy_variables, "$.policies.allowed_variables")
    _unique(policy_roots, "$.policies.allowed_path_roots")
    _exact(policy_variables, list(ALLOWED_VARIABLES), "$.policies.allowed_variables")
    _exact(policy_roots, list(ALLOWED_PATH_ROOTS), "$.policies.allowed_path_roots")

    root = root.resolve()
    skills_root = root / CANONICAL_SKILLS
    forbidden_root = root / FORBIDDEN_SKILLS
    if not skills_root.is_dir() or skills_root.is_symlink():
        _fail("SKILLS_SOURCE_INVALID", "$.skills.canonical_source", "canonical skills directory must exist and not be a symlink")
    if forbidden_root.exists() or forbidden_root.is_symlink():
        _fail("OPENCODE_SKILLS_FORBIDDEN", "$.runtime.forbidden_paths", str(forbidden_root))

    discovered_skills: list[str] = []
    for child in sorted(skills_root.iterdir()):
        if not child.is_dir():
            continue
        _identifier(child.name, f"{CANONICAL_SKILLS}/<id>")
        skill_file = child / "SKILL.md"
        if not skill_file.is_file():
            _fail("SKILL_DESCRIPTOR_MISSING", str(child), "SKILL.md is required")
        discovered_skills.append(child.name)
    _unique(discovered_skills, CANONICAL_SKILLS)
    for required_skill in required_skills:
        if required_skill not in discovered_skills:
            _fail("REQUIRED_SKILL_MISSING", "$.skills.required", required_skill)

    integrity = _strict_mapping(
        top["integrity"],
        "$.integrity",
        ("algorithm", "canonicalization", "manifest_sha256"),
    )
    _exact(integrity["algorithm"], "sha256", "$.integrity.algorithm")
    _exact(integrity["canonicalization"], CANONICALIZATION, "$.integrity.canonicalization")
    stored_digest = _string(integrity["manifest_sha256"], "$.integrity.manifest_sha256")
    if not DIGEST_PATTERN.fullmatch(stored_digest):
        _fail("INVALID_DIGEST_FORMAT", "$.integrity.manifest_sha256", stored_digest)
    if verify_digest:
        observed_digest = compute_manifest_digest(top)
        if stored_digest != observed_digest:
            _fail(
                "DIGEST_MISMATCH",
                "$.integrity.manifest_sha256",
                f"expected {observed_digest}, observed {stored_digest}",
            )


def validate_manifest_file(path: Path, root: Path | None = None) -> Mapping[str, Any]:
    document = load_manifest(path)
    validate_manifest(document, root or path.parent)
    return document


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path, help="MANIFEST.yaml to inspect")
    parser.add_argument("--root", type=Path, help="repository root; defaults to manifest parent")
    parser.add_argument("--compute-digest", action="store_true", help="print digest without comparing it")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv or sys.argv[1:])
    try:
        document = load_manifest(args.manifest)
        if args.compute_digest:
            print(compute_manifest_digest(document))
            return 0
        validate_manifest(document, args.root or args.manifest.parent)
    except ManifestValidationError as exc:
        print(
            f"MANIFEST_VALIDATION: FAIL code={exc.code} path={exc.path} message={exc.message}",
            file=sys.stderr,
        )
        return 1
    print("MANIFEST_VALIDATION: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
