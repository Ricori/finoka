"""Where the second-model referee runs, and whether it says anything.

Both promises come from ``patches/finesub/0007-referee-live-vram-and-verify-progress.patch``
and both were paid for in silence:

* The referee used to be put on the card from the *tier's* VRAM budget alone.
  On a `standard` card with a game open -- 2.4 GiB actually free against the
  6.5 the tier assumes -- it was loaded beside the Whisper pool anyway, and the
  collision either dragged the decode out for minutes with no event or killed
  the worker with an access violation that CTranslate2 cannot report. The
  desktop's log stopped on ``group ASR (...)`` and nothing followed.
* The tail verification pass then ran for minutes without a single event, which
  looks exactly like the hang above.

Behaviour, not source shape: a sync that rewrites either mechanism keeps this
file green as long as a busy card still sends the referee to the CPU and the
pass still reports.
"""

from __future__ import annotations

import unittest
from unittest import mock

import numpy as np

from finesub.reporting import reporting_to
from finesub.speech.recognition import lang_redecode
from finesub.speech.runtime import resources
from finesub.speech.verification import qwen_referee


class RecordingReporter:
    """Every call the engine can make on a reporter, kept for inspection."""

    def __init__(self) -> None:
        self.progress_calls: list[dict[str, object]] = []
        self.warnings: list[tuple[str, str]] = []

    def planned(self, stages) -> None:
        return

    def stage_started(self, stage, *, reused=False, detail="") -> None:
        return

    def progress(self, stage, *, completed, total=None, unit="", detail="") -> None:
        self.progress_calls.append(
            {
                "stage": stage,
                "completed": completed,
                "total": total,
                "unit": unit,
                "detail": detail,
            }
        )

    def summary(self, stage, metrics) -> None:
        return

    def warning(self, code, message, *, impact="", action="") -> None:
        self.warnings.append((code, message))

    def debug(self, message, fields=None) -> None:
        return

    def completed(self, output, elapsed_sec) -> None:
        return

    def failed(self, stage, message) -> None:
        return


def _place(free_gib, *, pool_resident, tier="standard", asr_device="cuda", **kwargs):
    """`referee_device` with the card's answer stubbed out.

    `cuda_usable` is stubbed too: the question here is the VRAM arithmetic, and
    on a machine with no CUDA at all every case would answer "cpu" for a reason
    the test is not about.
    """

    profile = resources.RESOURCE_PROFILES[tier]
    with mock.patch(
        "finesub.speech.runtime.device.cuda_usable", return_value=True
    ), mock.patch(
        "finesub.speech.runtime.device.free_vram_gib", return_value=free_gib
    ):
        return lang_redecode.referee_device(
            asr_device,
            profile,
            "large-v3-turbo",
            1,
            requested_device=kwargs.pop("requested_device", "cuda"),
            pool_resident=pool_resident,
            **kwargs,
        )


class RefereePlacementTests(unittest.TestCase):
    #: `standard` minus a resident large-v3-turbo pool. The tier says 4.43 GiB
    #: are spare whatever the card is really doing, which is the figure that
    #: used to decide this on its own.
    RESIDENT = 2.07

    def test_a_busy_card_keeps_the_referee_off_the_gpu(self) -> None:
        """The regression: 2.4 GiB free is not 4.43 GiB spare."""

        self.assertEqual(_place(2.40, pool_resident=True), "cpu")

    def test_a_free_card_still_gets_the_referee(self) -> None:
        """The feature has to survive its own fix.

        6.48 GiB free is the figure the desktop reported on the run that
        started this: at the moment of the check the card was fine, and the
        referee belongs on it.
        """

        self.assertEqual(_place(6.48, pool_resident=True), "cuda")

    def test_the_pool_is_bought_once(self) -> None:
        """`pool_resident` is the difference between two real call sites.

        The stage asks before it builds the pool (the free figure still has to
        pay for Whisper) and again to decide the warm beside it (it already
        has). 4.0 GiB free covers the referee alone but not the referee plus a
        2.07 GiB pool, so the two answers must differ here.
        """

        self.assertEqual(_place(4.00, pool_resident=True), "cuda")
        self.assertEqual(_place(4.00, pool_resident=False), "cpu")

    def test_an_unreadable_card_leaves_the_tier_in_charge(self) -> None:
        """No live figure is not evidence of a full card."""

        self.assertEqual(_place(None, pool_resident=True), "cuda")

    def test_the_demotion_is_announced(self) -> None:
        """A silent demotion is a slow verification nobody can explain."""

        reporter = RecordingReporter()
        with reporting_to(reporter):
            self.assertEqual(_place(0.66, pool_resident=True), "cpu")
        self.assertEqual([code for code, _ in reporter.warnings], ["referee-on-cpu"])

    def test_policy_still_outranks_the_card(self) -> None:
        """An idle card does not overturn an answer that was never about VRAM.

        `--device cpu` and `--gpu-tier cpu`-adjacent tiers decide before the
        arithmetic runs; so does an ASR that went to the CPU, where there is no
        pool to fit beside and the veto must not fire at all.
        """

        self.assertEqual(_place(24.0, pool_resident=True, requested_device="cpu"), "cpu")
        self.assertEqual(_place(24.0, pool_resident=True, tier="entry"), "cpu")
        self.assertEqual(_place(0.20, pool_resident=False, asr_device="cpu"), "cuda")


class _StubReader:
    """`_SpanReader` without a file: one second of silence for any span."""

    def __init__(self, path: str) -> None:
        self.path = path

    def read(self, start: float, end: float) -> np.ndarray:
        return np.zeros(qwen_referee.TARGET_SR, dtype=np.float32)


class _StubReferee:
    """Enough of `QwenReferee` for `apply_verification`, minus the model."""

    _model_name = "stub"
    requested_device = "cpu"

    def __init__(self) -> None:
        self.on_batch = None

    def transcribe_batch(self, clips, *, max_new_tokens=None, on_batch=None):
        self.on_batch = on_batch
        if on_batch is not None:
            on_batch(len(clips), len(clips))
        return [("", None)] * len(clips)


class VerificationProgressTests(unittest.TestCase):
    def test_the_pass_reports_before_and_after_the_model_runs(self) -> None:
        """The zero matters as much as the count.

        The load and the first `generate` are most of the wait, so a run that
        only reported after the first batch would still look hung for the part
        that actually looks hung.
        """

        reporter = RecordingReporter()
        referee = _StubReferee()
        with reporting_to(reporter), mock.patch.object(
            qwen_referee, "_SpanReader", _StubReader
        ):
            qwen_referee.apply_verification(
                [],
                vad_intervals=[{"start": 0.0, "end": 5.0}],
                audio_path="unused.wav",
                referee=referee,
            )

        self.assertIsNotNone(referee.on_batch, "the pass must pass its reporter in")
        counts = [(call["completed"], call["total"]) for call in reporter.progress_calls]
        self.assertEqual(counts, [(0, 1), (1, 1)])
        for call in reporter.progress_calls:
            self.assertEqual(call["unit"], "clips")
            # The tail of the ASR stage, not a stage of its own: a new stage
            # name here would read as the pipeline having moved on.
            self.assertEqual(call["stage"], "aligned")
            self.assertTrue(call["detail"])

    def test_nothing_to_verify_reports_nothing(self) -> None:
        """A 0/0 would be the one progress line that can never move."""

        reporter = RecordingReporter()
        with reporting_to(reporter):
            qwen_referee.apply_verification(
                [],
                vad_intervals=[],
                audio_path="unused.wav",
                referee=_StubReferee(),
            )
        self.assertEqual(reporter.progress_calls, [])


if __name__ == "__main__":
    unittest.main()
