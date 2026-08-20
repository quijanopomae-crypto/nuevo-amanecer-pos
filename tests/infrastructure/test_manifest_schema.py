from __future__ import annotations

import copy
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Callable

import yaml


LAB_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = LAB_ROOT / "orchestrator" / "schemas"
sys.path.insert(0, str(SCHEMA_DIR))

from validate_manifest import (  # noqa: E402
    ManifestValidationError,
    compute_manifest_digest,
    load_manifest,
    validate_manifest_file,
)


class ManifestSchemaContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.manifest_path = LAB_ROOT / "MANIFEST.yaml"
        cls.baseline = load_manifest(cls.manifest_path)

    def _case(
        self,
        mutate: Callable[[dict], None] | None = None,
        *,
        recompute_digest: bool = True,
        opencode_skills: bool = False,
    ) -> tuple[Path, Path]:
        temporary = tempfile.TemporaryDirectory(prefix="manifest-case-", dir=LAB_ROOT / "evidence")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        skills_root = root / ".agents" / "skills"
        skills_root.mkdir(parents=True)
        for skill_id in self.baseline["skills"]["required"]:
            skill_root = skills_root / skill_id
            skill_root.mkdir()
            (skill_root / "SKILL.md").write_text(
                f"---\nname: {skill_id}\ndescription: synthetic manifest fixture\n---\n",
                encoding="utf-8",
            )
        if opencode_skills:
            (root / ".opencode" / "skills").mkdir(parents=True)

        document = copy.deepcopy(dict(self.baseline))
        if mutate is not None:
            mutate(document)
        if recompute_digest:
            document["integrity"]["manifest_sha256"] = compute_manifest_digest(document)

        manifest_path = root / "MANIFEST.yaml"
        manifest_path.write_text(
            yaml.safe_dump(document, sort_keys=False, allow_unicode=True),
            encoding="utf-8",
        )
        return root, manifest_path

    def _assert_rejected(
        self,
        expected_code: str,
        mutate: Callable[[dict], None] | None = None,
        *,
        recompute_digest: bool = True,
        opencode_skills: bool = False,
    ) -> None:
        root, manifest_path = self._case(
            mutate,
            recompute_digest=recompute_digest,
            opencode_skills=opencode_skills,
        )
        with self.assertRaises(ManifestValidationError) as captured:
            validate_manifest_file(manifest_path, root)
        self.assertEqual(expected_code, captured.exception.code, str(captured.exception))

    def test_01_minimum_manifest_is_valid(self) -> None:
        validate_manifest_file(self.manifest_path, LAB_ROOT)

    def test_02_unknown_property_is_rejected(self) -> None:
        self._assert_rejected(
            "UNKNOWN_PROPERTY",
            lambda document: document["metadata"].__setitem__("unexpected", True),
        )

    def test_03_nonexistent_role_reference_is_rejected(self) -> None:
        self._assert_rejected(
            "UNKNOWN_ROLE_REFERENCE",
            lambda document: document["workflow"].__setitem__("entry_role", "missing-role"),
        )

    def test_04_nonexistent_model_reference_is_rejected(self) -> None:
        self._assert_rejected(
            "UNKNOWN_MODEL_REFERENCE",
            lambda document: document["roles"]["planner"].__setitem__("model_ref", "missing-model"),
        )

    def test_05_invalid_manifest_revision_is_rejected(self) -> None:
        self._assert_rejected(
            "INVALID_MANIFEST_REVISION",
            lambda document: document["metadata"].__setitem__("manifest_revision", 0),
        )

    def test_06_disallowed_environment_variable_is_rejected(self) -> None:
        self._assert_rejected(
            "DISALLOWED_VARIABLE",
            lambda document: document["paths"].__setitem__("evidence", "${HOME}/outside"),
        )

    def test_07_opencode_skills_directory_is_rejected(self) -> None:
        self._assert_rejected("OPENCODE_SKILLS_FORBIDDEN", opencode_skills=True)

    def test_08_duplicate_skill_id_is_rejected(self) -> None:
        self._assert_rejected(
            "DUPLICATE_ID",
            lambda document: document["skills"].__setitem__("required", ["audit", "audit"]),
        )

    def test_09_altered_digest_is_rejected(self) -> None:
        self._assert_rejected(
            "DIGEST_MISMATCH",
            lambda document: document["metadata"].__setitem__("name", "pos-infra-lab-altered"),
            recompute_digest=False,
        )


if __name__ == "__main__":
    unittest.main()
