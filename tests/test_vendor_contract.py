from __future__ import annotations

import importlib
import json
import sys
import tomllib
import unittest
from pathlib import Path

from scripts.sync_finesub import DEFAULT_VENDOR, sha256_file, verify_snapshot


class VendorContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = verify_snapshot(DEFAULT_VENDOR)

    def test_engine_packages_import_without_loading_models(self) -> None:
        source = DEFAULT_VENDOR / "src"
        sys.path.insert(0, str(source))
        previous = sys.dont_write_bytecode
        sys.dont_write_bytecode = True
        try:
            self.assertIsNotNone(importlib.import_module("finesub"))
            self.assertIsNotNone(importlib.import_module("finesub_bootstrap"))
        finally:
            sys.dont_write_bytecode = previous
            sys.path.remove(str(source))
            sys.modules.pop("finesub", None)
            sys.modules.pop("finesub_bootstrap", None)

    def test_version_and_runtime_metadata_match(self) -> None:
        project = tomllib.loads((DEFAULT_VENDOR / "pyproject.toml").read_text(encoding="utf-8"))
        self.assertEqual(project["project"]["version"], self.upstream["engine_version"])
        runtime = json.loads(
            (DEFAULT_VENDOR / "resources/runtime-manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(runtime["schema_version"], 1)
        self.assertTrue((DEFAULT_VENDOR / "runtime/pylock.win-py312.toml").is_file())
        self.assertTrue((DEFAULT_VENDOR / "runtime/pylock.win-py312.cn.toml").is_file())

    def test_nonoka_x_macos_media_manifests_are_packaged(self) -> None:
        resources = Path(__file__).resolve().parents[1] / "src/nonoka_x/resources"
        self.assertTrue((resources / "runtime-manifest.macos-arm64.json").is_file())
        self.assertTrue((resources / "runtime-manifest.macos-amd64.json").is_file())

    def test_required_package_data_is_vendored(self) -> None:
        prompt_root = DEFAULT_VENDOR / "src/finesub/llm/prompt_templates"
        self.assertTrue(any(prompt_root.glob("*.md")))
        self.assertTrue((prompt_root / "LICENSE.md").is_file())
        routing = DEFAULT_VENDOR / "src/finesub/llm/routing"
        self.assertTrue((routing / "model_catalog.psv").is_file())
        self.assertTrue((routing / "model_routes.toml").is_file())
        bootstrap = DEFAULT_VENDOR / "src/finesub_bootstrap"
        self.assertTrue((bootstrap / "model-manifest.json").is_file())
        self.assertTrue((bootstrap / "download-sources.json").is_file())

    def test_recorded_finesub_patches_are_present_and_hashed(self) -> None:
        patch_root = DEFAULT_VENDOR.parents[1] / "patches" / "finesub"
        patches = self.upstream.get("patches") or []
        self.assertTrue(patches)
        self.assertEqual(
            [entry["path"] for entry in patches],
            [path.name for path in sorted(patch_root.glob("*.patch"))],
        )
        for entry in patches:
            path = patch_root / entry["path"]
            self.assertTrue(path.is_file())
            self.assertEqual(sha256_file(path), entry["sha256"])


if __name__ == "__main__":
    unittest.main()
