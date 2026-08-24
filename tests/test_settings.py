from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path


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
                    {"GEMINI_FREE": "primary:gemini-secret", "EXA_KEYS": "exa-secret"}
                )
                self.assertTrue(snapshot["llmKeyConfigured"])
                self.assertTrue(snapshot["retrievalKeyConfigured"])
                encoded = repr(snapshot)
                self.assertNotIn("gemini-secret", encoded)
                self.assertNotIn("exa-secret", encoded)
                gemini = next(item for item in snapshot["keys"] if item["name"] == "GEMINI_FREE")
                self.assertEqual(gemini["count"], 1)
                self.assertEqual(gemini["masked"][0]["name"], "primary")
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


if __name__ == "__main__":
    unittest.main()
