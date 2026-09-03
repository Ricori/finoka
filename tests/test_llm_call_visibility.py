"""What the task log says when an LLM call goes wrong.

Both behaviours under test live in the vendored engine (patches 0009 and 0010)
and exist for one reason: before them, a run whose provider was rate limiting,
out of balance, or truncating every answer looked from the desktop like a stage
that had stopped moving. The contract is not the wording -- it is that the first
occurrence of each problem reaches `warning`, that repeats degrade to `debug`
instead of flooding, and that the numbers a user needs to act on are in the line.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "third_party/finesub/src"))

from finesub.reporting import reporting_to


class RecordingReporter:
    def __init__(self) -> None:
        self.warnings: list[tuple[str, str, str, str]] = []
        self.debugs: list[tuple[str, dict]] = []

    def planned(self, stages) -> None:
        return

    def stage_started(self, stage, *, reused=False, detail="") -> None:
        return

    def progress(self, stage, *, completed, total=None, unit="", detail="") -> None:
        return

    def summary(self, stage, metrics) -> None:
        return

    def warning(self, code, message, *, impact="", action="") -> None:
        self.warnings.append((code, message, impact, action))

    def debug(self, message, fields=None) -> None:
        self.debugs.append((message, dict(fields or {})))

    def completed(self, output, elapsed_sec) -> None:
        return

    def failed(self, stage, message) -> None:
        return


class OutputTruncationWarningTests(unittest.TestCase):
    def _run_stub(self):
        state = {"count": 0}

        def note() -> bool:
            state["count"] += 1
            return state["count"] == 1

        return SimpleNamespace(note_output_truncation=note, seen=state)

    def test_first_truncation_warns_with_the_numbers_that_explain_it(self) -> None:
        from finesub.llm.stages.correction.attempts import _warn_output_truncated

        reporter = RecordingReporter()
        run = self._run_stub()
        with reporting_to(reporter):
            _warn_output_truncated(
                run,
                window=SimpleNamespace(chunk_id="0001"),
                model="deepseek-v4-flash",
                check={
                    "observed_output_tokens": 16_380,
                    "thinking_tokens": 12_000,
                    "max_output_tokens": 16_384,
                },
                splittable=True,
            )
        self.assertEqual(len(reporter.warnings), 1)
        code, message, impact, action = reporter.warnings[0]
        self.assertEqual(code, "correction-output-truncated")
        self.assertIn("0001", message)
        self.assertIn("deepseek-v4-flash", message)
        # Both numbers: the cap says what to raise, the thinking share says
        # whether raising it is even the right move.
        self.assertIn("16380/16384", message)
        self.assertIn("12000", message)
        self.assertTrue(impact)
        self.assertTrue(action)

    def test_later_truncations_stay_quiet(self) -> None:
        from finesub.llm.stages.correction.attempts import _warn_output_truncated

        reporter = RecordingReporter()
        run = self._run_stub()
        check = {
            "observed_output_tokens": 16_380,
            "thinking_tokens": 0,
            "max_output_tokens": 16_384,
        }
        with reporting_to(reporter):
            for chunk in ("0001", "0001-a", "0001-a-a"):
                _warn_output_truncated(
                    run,
                    window=SimpleNamespace(chunk_id=chunk),
                    model="m",
                    check=check,
                    splittable=True,
                )
        self.assertEqual(len(reporter.warnings), 1)
        self.assertEqual(run.seen["count"], 3)

    def test_a_missing_usage_report_says_so_instead_of_quoting_zero(self) -> None:
        from finesub.llm.stages.correction.attempts import _warn_output_truncated

        reporter = RecordingReporter()
        with reporting_to(reporter):
            _warn_output_truncated(
                self._run_stub(),
                window=SimpleNamespace(chunk_id="0007"),
                model="m",
                check={
                    "observed_output_tokens": 0,
                    "thinking_tokens": 0,
                    "max_output_tokens": 16_384,
                },
                splittable=False,
            )
        message = reporter.warnings[0][1]
        self.assertIn("usage", message)
        self.assertNotIn("0/16384", message)


class ProviderFailureVisibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        from finesub.llm import llm_runtime

        # Process-wide dedupe: a test that ran second would otherwise see the
        # first one's signature and assert against a debug line.
        llm_runtime._REPORTED_PROVIDER_FAILURES.clear()
        self.addCleanup(llm_runtime._REPORTED_PROVIDER_FAILURES.clear)

    def test_first_failure_of_a_kind_warns_and_keeps_the_providers_words(self) -> None:
        from finesub.llm.llm_runtime import _report_provider_failure

        reporter = RecordingReporter()
        with reporting_to(reporter):
            _report_provider_failure(
                RuntimeError('HTTP 402 {"error":{"message":"Insufficient Balance"}}'),
                provider_tier="NONOKA_OPENAI_COMPAT",
                model_name="deepseek-v4-flash",
                return_code="402",
                attempt=0,
                key_label="primary",
                outcome="rotate",
            )
        self.assertEqual(len(reporter.warnings), 1)
        code, message, impact, _action = reporter.warnings[0]
        self.assertEqual(code, "llm-call-failed")
        self.assertIn("402", message)
        # The provider's sentence is the diagnosis; a classification word would
        # throw away the only part that says what to do.
        self.assertIn("Insufficient Balance", message)
        self.assertIn("Key", impact)

    def test_repeats_of_the_same_failure_degrade_to_debug(self) -> None:
        from finesub.llm.llm_runtime import _report_provider_failure

        reporter = RecordingReporter()
        with reporting_to(reporter):
            for attempt in range(4):
                _report_provider_failure(
                    RuntimeError("HTTP 429 rate limit"),
                    provider_tier="NONOKA_OPENAI_COMPAT",
                    model_name="deepseek-v4-flash",
                    return_code="429",
                    attempt=attempt,
                    key_label="primary",
                    outcome="等待 8s 后重试同一个 Key",
                )
        self.assertEqual(len(reporter.warnings), 1)
        self.assertEqual(len(reporter.debugs), 3)
        message, fields = reporter.debugs[0]
        self.assertEqual(message, "llm call failed")
        self.assertEqual(fields["code"], "429")
        self.assertEqual(fields["attempt"], 1)
        self.assertIn("等待", fields["outcome"])

    def test_a_different_code_is_news_again(self) -> None:
        from finesub.llm.llm_runtime import _report_provider_failure

        reporter = RecordingReporter()
        with reporting_to(reporter):
            for code in ("429", "429", "500"):
                _report_provider_failure(
                    RuntimeError(f"HTTP {code}"),
                    provider_tier="NONOKA_OPENAI_COMPAT",
                    model_name="deepseek-v4-flash",
                    return_code=code,
                    attempt=0,
                    key_label="primary",
                    outcome="give_up",
                )
        self.assertEqual([warning[1].split("：")[1] for warning in reporter.warnings],
                         ["429 · RuntimeError: HTTP 429", "500 · RuntimeError: HTTP 500"])

    def test_a_long_body_is_trimmed_rather_than_dropped(self) -> None:
        from finesub.llm.llm_runtime import _short_error

        trimmed = _short_error(RuntimeError("x" * 1000))
        self.assertLessEqual(len(trimmed), 240)
        self.assertTrue(trimmed.endswith("…"))


if __name__ == "__main__":
    unittest.main()
