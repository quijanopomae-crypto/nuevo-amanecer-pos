"""Small dependency graph contract for synthetic modules."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


MODULE_FIELDS = frozenset(
    {
        "module",
        "depends_on",
        "read_dependencies",
        "write_dependencies",
        "shared_globals",
        "storage",
        "dom",
        "tests",
    }
)


class DependencyMapError(ValueError):
    pass


def _list(value: Any, field: str) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        raise DependencyMapError(f"{field} must be a list")
    result = tuple(value)
    if any(not isinstance(item, str) or not item.strip() for item in result):
        raise DependencyMapError(f"{field} entries must be non-empty strings")
    if len(set(result)) != len(result):
        raise DependencyMapError(f"{field} contains duplicates")
    return result


@dataclass(frozen=True)
class ModuleDependency:
    module: str
    depends_on: tuple[str, ...]
    read_dependencies: tuple[str, ...]
    write_dependencies: tuple[str, ...]
    shared_globals: tuple[str, ...]
    storage: tuple[str, ...]
    dom: tuple[str, ...]
    tests: tuple[str, ...]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "ModuleDependency":
        if not isinstance(value, dict) or set(value) != MODULE_FIELDS:
            raise DependencyMapError("module dependency requires its exact field set")
        module = value["module"]
        if not isinstance(module, str) or not module.strip():
            raise DependencyMapError("module must be a non-empty string")
        return cls(
            module=module,
            **{field: _list(value[field], field) for field in MODULE_FIELDS - {"module"}},
        )

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        for field in MODULE_FIELDS - {"module"}:
            value[field] = list(value[field])
        return value


@dataclass(frozen=True)
class DependencyMap:
    modules: tuple[ModuleDependency, ...]

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "DependencyMap":
        if not isinstance(value, dict) or set(value) != {"modules"} or not isinstance(value["modules"], list):
            raise DependencyMapError("Dependency Map requires modules list")
        modules = tuple(ModuleDependency.from_dict(item) for item in value["modules"])
        names = [item.module for item in modules]
        if len(set(names)) != len(names):
            raise DependencyMapError("duplicate module")
        known = set(names)
        for item in modules:
            if item.module in item.depends_on:
                raise DependencyMapError("module cannot depend on itself")
            unknown = set(item.depends_on) - known
            if unknown:
                raise DependencyMapError(f"unknown module dependencies: {sorted(unknown)}")
        return cls(modules)

    def to_dict(self) -> dict[str, Any]:
        return {"modules": [item.to_dict() for item in self.modules]}
