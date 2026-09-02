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

from nonoka_x.settings import FineSubSettings


class FineSubSettingsTests(unittest.TestCase):
    def setUp(self) -> None:
        # The engine caches config, catalog and routes per process, so a test
        # that pins a route would otherwise answer the next one's questions.
        from finesub.config import clear_config_cache
        from finesub.llm.routing.model_catalog import default_model_catalog
        from finesub.llm.routing.model_routes import default_model_routes

        for reset in (clear_config_cache, default_model_catalog.cache_clear, default_model_routes.cache_clear):
            reset()
            self.addCleanup(reset)

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
                    # The research route below points at Gemini, and a
                    # provider without a key cannot be routed to.
                    "GEMINI_FREE": "gemini-secret",
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
            self.assertIn('default_target = "nonoka-openai-', config)
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
            correction_mid, _ = routes.resolve_binding(
                routes.active_preset_id, "correction-text", "intermediate"
            )
            correction_eff, _ = routes.resolve_binding(
                routes.active_preset_id, "correction-text", "efficiency"
            )
            research, _ = routes.resolve_binding(
                routes.active_preset_id, "research", "quality"
            )
            self.assertTrue(correction.target_ids[0].startswith("nonoka-openai-"))
            self.assertTrue(correction_mid.target_ids[0].startswith("nonoka-openai-"))
            self.assertTrue(correction_eff.target_ids[0].startswith("nonoka-openai-"))
            self.assertEqual(research.target_ids[0], "gemini-free-3_6-flash")

    def test_llm_is_not_ready_until_a_global_model_is_saved(self) -> None:
        # A key on its own configures nothing: without a saved global model the
        # desktop must not offer 「最终字幕」.
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            snapshot = settings.update_keys({"GEMINI_FREE": "gemini-secret"})
            self.assertTrue(snapshot["llmKeyConfigured"])
            self.assertFalse(snapshot["llmReady"])

            snapshot = settings.update_keys(
                {
                    "LLM_DEFAULT_PROVIDER": "gemini-free",
                    "LLM_DEFAULT_MODEL": "gemini/gemini-3.6-flash",
                }
            )
            self.assertTrue(snapshot["llmReady"])

    def test_llm_is_not_ready_when_the_saved_provider_lost_its_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            settings.update_keys(
                {
                    "GEMINI_FREE": "gemini-secret",
                    "LLM_DEFAULT_PROVIDER": "gemini-free",
                    "LLM_DEFAULT_MODEL": "gemini/gemini-3.6-flash",
                }
            )
            snapshot = settings.update_keys({"GEMINI_FREE": None})
            self.assertFalse(snapshot["llmReady"])

    def test_llm_is_not_ready_when_a_compat_endpoint_has_no_base_url(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            snapshot = settings.update_keys(
                {
                    "OPENAI_COMPAT_API_KEY": "compat-secret",
                    "OPENAI_COMPAT_BASE_URL": "https://vendor.example/v1",
                    "LLM_DEFAULT_PROVIDER": "openai-compat",
                    "LLM_DEFAULT_MODEL": "vendor-model",
                }
            )
            self.assertTrue(snapshot["llmReady"])
            snapshot = settings.update_keys({"OPENAI_COMPAT_BASE_URL": None})
            self.assertFalse(snapshot["llmReady"])

    def test_local_agent_is_only_ready_once_its_route_is_saved_and_the_cli_exists(self) -> None:
        # Having codex on the machine is not a configuration — the route has to
        # be saved — and a saved route to a CLI that is gone is not usable.
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            with patch("nonoka_x.settings.shutil.which", return_value="/usr/local/bin/codex"):
                self.assertFalse(settings.snapshot()["llmReady"])
                snapshot = settings.update_keys(
                    {
                        "LLM_DEFAULT_PROVIDER": "local-codex",
                        "LLM_DEFAULT_MODEL": "gpt-5.6-sol",
                    }
                )
                self.assertTrue(snapshot["llmReady"])
            with patch("nonoka_x.settings.shutil.which", return_value=None), patch(
                "nonoka_x.settings.os.name", "posix"
            ):
                self.assertFalse(settings.snapshot()["llmReady"])

    def test_local_codex_route_binds_the_packaged_agent_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            snapshot = settings.update_keys(
                {
                    "LLM_DEFAULT_PROVIDER": "local-codex",
                    "LLM_DEFAULT_MODEL": "gpt-5.6-sol",
                }
            )
            codex = next(
                item for item in snapshot["modelRouting"]["providers"] if item["id"] == "local-codex"
            )
            self.assertFalse(codex["requiresKey"])
            self.assertEqual(codex["mode"], "select")
            # Sol leads the roster, so selecting the provider fills it in.
            self.assertEqual([model["id"] for model in codex["models"]], ["gpt-5.6-sol", "gpt-5.6-terra"])
            self.assertEqual(codex["defaultModel"], "gpt-5.6-sol")
            config = (Path(temporary) / "finesub.toml").read_text(encoding="utf-8")
            self.assertIn('default_target = "local-codex-completion-gpt-5_6-sol"', config)

            from finesub.config import clear_config_cache
            from finesub.llm.routing.model_catalog import default_model_catalog
            from finesub.llm.routing.model_routes import default_model_routes

            clear_config_cache()
            default_model_catalog.cache_clear()
            default_model_routes.cache_clear()
            routes = default_model_routes()
            correction, _ = routes.resolve_binding(
                routes.active_preset_id, "correction-text", "quality"
            )
            # Alone: a selected local CLI runs on the user's own
            # subscription, so the packaged API tail is not a fallback
            # they asked for. A window this CLI cannot serve now fails
            # its capability check naming the CLI, instead of quietly
            # continuing on a Gemini tier that may have no key at all.
            self.assertEqual(
                correction.target_ids, ("local-codex-completion-gpt-5_6-sol",)
            )

    def test_local_agy_route_binds_the_packaged_agent_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            snapshot = settings.update_keys(
                {
                    "LLM_DEFAULT_PROVIDER": "local-agy",
                    "LLM_DEFAULT_MODEL": "gemini-3.7-flash",
                }
            )
            agy = next(
                item for item in snapshot["modelRouting"]["providers"] if item["id"] == "local-agy"
            )
            self.assertFalse(agy["requiresKey"])
            self.assertEqual(agy["mode"], "select")
            self.assertEqual(
                [model["id"] for model in agy["models"]],
                ["gemini-3.7-flash", "claude-opus-4-6-thinking"],
            )
            self.assertEqual(agy["defaultModel"], "gemini-3.7-flash")
            # The multimodal model is why agy leads with it; the snapshot has
            # to carry that through to the picker.
            self.assertTrue(agy["models"][0]["supportsAudio"])
            self.assertTrue(agy["models"][0]["supportsVideo"])
            config = (Path(temporary) / "finesub.toml").read_text(encoding="utf-8")
            # The media target, not the search-entitled twin: a pinned target
            # is prepended to the bound group, so `retrieval=native` has to
            # stay free to fall through.
            self.assertIn('default_target = "local-agy-media-gemini-3_7-flash"', config)

            from finesub.config import clear_config_cache
            from finesub.llm.routing.model_catalog import default_model_catalog
            from finesub.llm.routing.model_routes import default_model_routes

            clear_config_cache()
            default_model_catalog.cache_clear()
            default_model_routes.cache_clear()
            routes = default_model_routes()
            correction, _ = routes.resolve_binding(
                routes.active_preset_id, "correction-text", "quality"
            )
            self.assertEqual(
                correction.target_ids, ("local-agy-media-gemini-3_7-flash",)
            )

    def test_local_agy_opus_route_binds_its_own_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            settings.update_keys(
                {
                    "LLM_ROUTE_CORRECTION_PROVIDER": "local-agy",
                    "LLM_ROUTE_CORRECTION_MODEL": "claude-opus-4-6-thinking",
                }
            )
            config = (Path(temporary) / "finesub.toml").read_text(encoding="utf-8")
            self.assertIn('task_route_correction = "local-agy-opus-4_6"', config)

    def test_unknown_local_agy_model_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            with self.assertRaisesRegex(ValueError, "not available in local-agy"):
                settings.update_keys(
                    {
                        "LLM_DEFAULT_PROVIDER": "local-agy",
                        "LLM_DEFAULT_MODEL": "gemini-nope",
                    }
                )

    def test_codex_installed_off_path_is_still_found_and_put_back_on_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "OpenAI" / "Codex" / "bin"
            live = app / "6ca77c4a9caa4eed"
            live.mkdir(parents=True)
            (live / "codex.exe").write_bytes(b"")
            staging = app / ".staging-abcdef"
            staging.mkdir()
            (staging / "codex.exe").write_bytes(b"")
            with patch.dict(os.environ, {"LOCALAPPDATA": temporary}, clear=False), patch(
                "nonoka_x.settings.shutil.which", return_value=None
            ), patch("nonoka_x.settings.os.name", "nt"):
                from nonoka_x.settings import local_agent_executable, local_agent_path_entries

                self.assertEqual(local_agent_executable("local-codex"), live / "codex.exe")
                self.assertEqual(local_agent_path_entries(), [str(live)])

    def test_agy_installed_off_path_is_still_found_and_put_back_on_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            bin_dir = Path(temporary) / "agy" / "bin"
            bin_dir.mkdir(parents=True)
            (bin_dir / "agy.exe").write_bytes(b"")
            with patch.dict(os.environ, {"LOCALAPPDATA": temporary}, clear=False), patch(
                "nonoka_x.settings.shutil.which", return_value=None
            ), patch("nonoka_x.settings.os.name", "nt"):
                from nonoka_x.settings import local_agent_executable, local_agent_path_entries

                self.assertEqual(local_agent_executable("local-agy"), bin_dir / "agy.exe")
                self.assertEqual(local_agent_path_entries(), [str(bin_dir)])

    def test_antigravity_ide_alone_does_not_count_as_the_agy_cli(self) -> None:
        # The Electron IDE installs under %LOCALAPPDATA%/Programs/antigravity
        # and ships no `agy` at all; reporting it as available would put a
        # provider in the picker that every call then fails on.
        with tempfile.TemporaryDirectory() as temporary:
            ide = Path(temporary) / "Programs" / "antigravity"
            ide.mkdir(parents=True)
            (ide / "Antigravity.exe").write_bytes(b"")
            with patch.dict(os.environ, {"LOCALAPPDATA": temporary}, clear=False), patch(
                "nonoka_x.settings.shutil.which", return_value=None
            ), patch("nonoka_x.settings.os.name", "nt"):
                from nonoka_x.settings import local_agent_executable

                self.assertIsNone(local_agent_executable("local-agy"))

    def test_local_agent_on_path_is_not_added_to_it_twice(self) -> None:
        with patch("nonoka_x.settings.shutil.which", return_value="/usr/local/bin/codex"):
            from nonoka_x.settings import local_agent_path_entries

            self.assertEqual(local_agent_path_entries(), [])

    def test_terra_route_binds_its_own_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            settings.update_keys(
                {
                    "LLM_ROUTE_CORRECTION_PROVIDER": "local-codex",
                    "LLM_ROUTE_CORRECTION_MODEL": "gpt-5.6-terra",
                }
            )
            config = (Path(temporary) / "finesub.toml").read_text(encoding="utf-8")
            self.assertIn('task_route_correction = "local-codex-completion-gpt-5_6-terra"', config)

    def test_unknown_local_codex_model_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            with self.assertRaisesRegex(ValueError, "not available in local-codex"):
                settings.update_keys(
                    {
                        "LLM_DEFAULT_PROVIDER": "local-codex",
                        "LLM_DEFAULT_MODEL": "gpt-nope",
                    }
                )

    def test_compat_provider_keeps_its_own_endpoint_and_key(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            snapshot = settings.update_keys(
                {
                    "OPENAI_COMPAT_API_KEY": "compat-secret",
                    "OPENAI_COMPAT_BASE_URL": "https://vendor.example/v1/",
                    "LLM_DEFAULT_PROVIDER": "openai-compat",
                    "LLM_DEFAULT_MODEL": "vendor-large",
                }
            )
            provider = next(
                item
                for item in snapshot["modelRouting"]["providers"]
                if item["id"] == "openai-compat"
            )
            self.assertTrue(provider["customEndpoint"])
            self.assertTrue(provider["keyConfigured"])
            self.assertEqual(provider["keyName"], "OPENAI_COMPAT_API_KEY")
            catalog = (Path(temporary) / "model_catalog.psv").read_text(encoding="utf-8")
            self.assertIn(
                "openai_compat|https://vendor.example/v1|OPENAI_COMPAT_API_KEY", catalog
            )
            # The official OpenAI address is untouched by the compat endpoint.
            official = next(
                item for item in snapshot["baseUrls"] if item["name"] == "OPENAI_BASE_URL"
            )
            self.assertFalse(official["customized"])

    def test_api_provider_keeps_the_packaged_tail_behind_it(self) -> None:
        """Only a local CLI drops the fallback.

        A compat endpoint is text-only, so the packaged candidates behind it
        are what keeps an audio or video window routable at all. The
        no-fallback rule is about running on somebody's own CLI subscription,
        not about pinning in general.
        """

        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            settings.update_keys(
                {
                    "OPENAI_COMPAT_API_KEY": "compat-secret",
                    "OPENAI_COMPAT_BASE_URL": "https://vendor.example/v1",
                    "LLM_DEFAULT_PROVIDER": "openai-compat",
                    "LLM_DEFAULT_MODEL": "vendor-large",
                }
            )

            from finesub.config import clear_config_cache
            from finesub.llm.routing.model_catalog import default_model_catalog
            from finesub.llm.routing.model_routes import default_model_routes

            clear_config_cache()
            default_model_catalog.cache_clear()
            default_model_routes.cache_clear()
            routes = default_model_routes()
            correction, _ = routes.resolve_binding(
                routes.active_preset_id, "correction-text", "quality"
            )
            self.assertGreater(len(correction.target_ids), 1)

    def test_compat_provider_without_a_base_url_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            with self.assertRaisesRegex(ValueError, "base URL is required"):
                settings.update_keys(
                    {
                        "ANTHROPIC_COMPAT_API_KEY": "compat-secret",
                        "LLM_DEFAULT_PROVIDER": "anthropic-compat",
                        "LLM_DEFAULT_MODEL": "vendor-sonnet",
                    }
                )

    def test_provider_without_a_key_cannot_be_routed_to(self) -> None:
        with tempfile.TemporaryDirectory() as temporary, patch.dict(
            os.environ, {"FINESUB_ENV_PROTECT": "0"}, clear=False
        ):
            settings = FineSubSettings(temporary)
            settings.bind_environment()
            with self.assertRaisesRegex(ValueError, "API key is required"):
                settings.update_keys(
                    {"LLM_DEFAULT_PROVIDER": "openai", "LLM_DEFAULT_MODEL": "gpt-custom"}
                )


if __name__ == "__main__":
    unittest.main()
