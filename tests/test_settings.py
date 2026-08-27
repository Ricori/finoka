from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "third_party/finesub/src"))

from finoka.settings import FineSubSettings


class FineSubSettingsTests(unittest.TestCase):
    def test_keys_are_saved_in_finesub_format_but_never_returned(self) -> None:
        previous = os.environ.get("FINESUB_ENV_PROTECT")
        os.environ["FINESUB_ENV_PROTECT"] = "0"
        try:
            with tempfile.TemporaryDirectory() as temporary:
                settings = FineSubSettings(temporary)
                settings.bind_environment()
                snapshot = settings.update_keys(
                    {
                        "GEMINI_FREE": "primary:gemini-secret",
                        "EXA_KEYS": "exa-secret",
                        "GEMINI_BASE_URL": "https://gemini.example.test/v1beta/",
                    }
                )
                self.assertTrue(snapshot["llmKeyConfigured"])
                self.assertTrue(snapshot["retrievalKeyConfigured"])
                encoded = repr(snapshot)
                self.assertNotIn("gemini-secret", encoded)
                self.assertNotIn("exa-secret", encoded)
                gemini = next(item for item in snapshot["keys"] if item["name"] == "GEMINI_FREE")
                self.assertEqual(gemini["count"], 1)
                self.assertEqual(gemini["masked"][0]["name"], "primary")
                gemini_base_url = next(
                    item for item in snapshot["baseUrls"] if item["name"] == "GEMINI_BASE_URL"
                )
                self.assertEqual(gemini_base_url["value"], "https://gemini.example.test/v1beta")
                self.assertTrue(gemini_base_url["customized"])
                if os.name != "nt":
                    self.assertEqual((Path(temporary) / "finesub.env").stat().st_mode & 0o077, 0)
        finally:
            if previous is None:
                os.environ.pop("FINESUB_ENV_PROTECT", None)
            else:
                os.environ["FINESUB_ENV_PROTECT"] = previous

    def test_unknown_key_name_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "Unknown FineSub key"):
                FineSubSettings(temporary).update_keys({"NOT_A_KEY": "secret"})

    def test_invalid_base_url_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(ValueError, "must be an http"):
                FineSubSettings(temporary).update_keys({"OPENAI_BASE_URL": "not-a-url"})

    def test_model_routing_writes_custom_catalog_and_task_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            snapshot = settings.update_keys(
                {
                    "OPENAI_API_KEY": "openai-secret",
                    "OPENAI_BASE_URL": "https://proxy.example/v1",
                    "LLM_DEFAULT_PROVIDER": "openai",
                    "LLM_DEFAULT_MODEL": "gpt-custom",
                    "LLM_ROUTE_RESEARCH_PROVIDER": "gemini-free",
                    "LLM_ROUTE_RESEARCH_MODEL": "gemini/gemini-3.6-flash",
                }
            )
            self.assertEqual(
                snapshot["modelRouting"]["defaultRoute"],
                {"provider": "openai", "model": "gpt-custom"},
            )
            catalog = (Path(temporary) / "model_catalog.psv").read_text(encoding="utf-8")
            self.assertIn("openai_compat|https://proxy.example/v1|OPENAI_API_KEY", catalog)
            self.assertIn("|gpt-custom|gpt-custom|", catalog)
            config = (Path(temporary) / "finesub.toml").read_text(encoding="utf-8")
            self.assertIn('default_target = "finoka-openai-', config)
            self.assertIn('task_route_research = "gemini-free-3_6-flash"', config)

            from finesub.config import clear_config_cache
            from finesub.llm.routing.model_catalog import default_model_catalog
            from finesub.llm.routing.model_routes import default_model_routes

            clear_config_cache()
            default_model_catalog.cache_clear()
            routes = default_model_routes()
            correction, _ = routes.resolve_binding(
                routes.active_preset_id, "correction-text", "quality"
            )
            research, _ = routes.resolve_binding(
                routes.active_preset_id, "research", "quality"
            )
            self.assertTrue(correction.target_ids[0].startswith("finoka-openai-"))
            self.assertEqual(research.target_ids[0], "gemini-free-3_6-flash")


if __name__ == "__main__":
    unittest.main()
