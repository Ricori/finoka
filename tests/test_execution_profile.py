from __future__ import annotations

import os
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "third_party/finesub/src"))

from finesub.execution import (
    cloud_execution_enabled,
    execution_profile_scope,
    normalize_execution_profile,
)
from finesub.execution_policy import refine_compute_type, separator_sample_rate


class ExecutionProfileTests(unittest.TestCase):
    def test_local_is_the_default(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(normalize_execution_profile(), "local")
            self.assertFalse(cloud_execution_enabled())

    def test_explicit_scope_overrides_environment_without_leaking(self) -> None:
        with patch.dict(os.environ, {"FINESUB_EXECUTION_PROFILE": "local"}):
            with execution_profile_scope("cloud"):
                self.assertTrue(cloud_execution_enabled())
            self.assertFalse(cloud_execution_enabled())

    def test_invalid_profile_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported execution profile"):
            normalize_execution_profile("desktop")

    def test_local_keeps_legacy_separator_cache_key(self) -> None:
        from finesub.speech.preprocessing.separator import accel

        fake_torch = types.SimpleNamespace(
            __version__="2.11.0",
            version=types.SimpleNamespace(cuda="12.8"),
            cuda=types.SimpleNamespace(
                is_available=lambda: True,
                get_device_capability=lambda: (8, 9),
            ),
        )
        with patch.dict(sys.modules, {"torch": fake_torch}):
            with execution_profile_scope("local"):
                local_key = accel.cache_key("model.ckpt", batch_size=4)
            with execution_profile_scope("cloud"):
                cloud_key = accel.cache_key("model.ckpt", batch_size=4)
        self.assertTrue(local_key.startswith("v1-2.11.0-cuda12.8-sm89-"))
        self.assertNotIn("-bs", local_key)
        self.assertTrue(cloud_key.startswith("v4-2.11.0-cuda12.8-sm89-bs4-"))

    def test_profile_policies_are_dependency_free_and_explicit(self) -> None:
        sample_rates = {"cost": 16_000, "quality": 44_100}
        with execution_profile_scope("local"):
            self.assertEqual(refine_compute_type("cpu"), "float32")
            self.assertEqual(refine_compute_type("cuda:0"), "float16")
            self.assertIsNone(separator_sample_rate("cost", sample_rates))
        with execution_profile_scope("cloud"):
            self.assertEqual(refine_compute_type("cpu"), "int8")
            self.assertEqual(refine_compute_type("cuda:0"), "float16")
            self.assertEqual(separator_sample_rate("cost", sample_rates), 16_000)


if __name__ == "__main__":
    unittest.main()
