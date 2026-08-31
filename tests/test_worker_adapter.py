from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from finoka import worker


class WorkerAdapterTests(unittest.TestCase):
    def test_task_request_maps_to_pipeline_and_returns_hashed_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            task_dir = Path(temp) / "task"
            source = Path(temp) / "video.mp4"
            source.write_bytes(b"media")
            captured: dict = {}

            def run_pipeline(input_path, **kwargs):
                captured["input"] = input_path
                captured.update(kwargs)
                output = Path(kwargs["output_path"])
                output.parent.mkdir(parents=True, exist_ok=True)
                stable = output.with_name(f"{output.stem}-stable.json")
                raw = output.with_name(f"{output.stem}-raw.srt")
                stable.write_text('{"segments": []}\n', encoding="utf-8")
                raw.write_text("1\n00:00:00,000 --> 00:00:01,000\nx\n", encoding="utf-8")
                return SimpleNamespace(stable_json=stable, raw_srt=raw, final_srt=output)

            @contextlib.contextmanager
            def passthrough(_value):
                yield

            finesub = types.ModuleType("finesub")
            finesub.__path__ = []
            pipeline = types.ModuleType("finesub.pipeline")
            pipeline.run_pipeline = run_pipeline
            reporting = types.ModuleType("finesub.reporting")
            reporting.reporting_to = passthrough
            reporting.quieted_libraries = passthrough
            previous = {name: sys.modules.get(name) for name in ("finesub", "finesub.pipeline", "finesub.reporting")}
            sys.modules.update({"finesub": finesub, "finesub.pipeline": pipeline, "finesub.reporting": reporting})
            request = {
                "schema": 1,
                "provider": "local",
                "source": {"kind": "local_file", "path": str(source), "title": "video"},
                "target": "raw-srt",
                "language": "ja",
                "device": "cuda:0",
                "gpu_budget_gb": 8,
                "correction": {"media": "audio", "retrieval": "local", "difficulty": "quality"},
                "knowledge": "none",
            }
            output = io.StringIO()
            old_stdin = sys.stdin
            old_cuda_visible = os.environ.get("CUDA_VISIBLE_DEVICES")
            try:
                sys.stdin = io.StringIO(json.dumps(request) + "\n")
                with contextlib.redirect_stdout(output):
                    result = worker.main(
                        [
                            "--task-id",
                            "abc123",
                            "--task-dir",
                            str(task_dir),
                            "--vendor",
                            str(ROOT / "third_party/finesub"),
                        ]
                    )
            finally:
                sys.stdin = old_stdin
                if old_cuda_visible is not None:
                    os.environ["CUDA_VISIBLE_DEVICES"] = old_cuda_visible
                else:
                    os.environ.pop("CUDA_VISIBLE_DEVICES", None)
                for name, value in previous.items():
                    if value is None:
                        sys.modules.pop(name, None)
                    else:
                        sys.modules[name] = value
            self.assertEqual(result, 0)
            self.assertEqual(captured["input"], str(source))
            self.assertEqual(captured["stage"], "raw-srt")
            self.assertEqual(captured["device"], "cuda")
            # No profile switch and no separator profile: the local worker
            # calls `run_pipeline` with upstream's own arguments, which is what
            # makes "local is unpatched upstream" checkable rather than a claim.
            self.assertNotIn("execution_profile", captured)
            self.assertNotIn("vocal_profile", captured)
            self.assertTrue(captured["resume"])
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            completed = next(event for event in events if event["type"] == "completed")
            manifest = completed["payload"]["artifacts"]
            self.assertEqual(manifest["engine_commit"], "8a33092a40ab4d86872941155143fd91b84eaa56")
            self.assertEqual(set(manifest["artifacts"]), {"stable_json", "raw_srt"})
            self.assertEqual(len(manifest["artifacts"]["stable_json"]["sha256"]), 64)

    def test_uncalibrated_vector_notice_is_dropped_but_siblings_still_speak(self) -> None:
        # Driven through the engine's own `profile_warnings` rather than a
        # hand-written string: the suppression matches on wording, so an
        # upstream rewording has to fail here instead of quietly letting the
        # line back into every task log.
        from finesub.llm.routing.capabilities import profile_warnings
        from finesub.llm.routing.profiles import parse_profile_id

        vector = (
            "correction_media=video,planning_media=video,"
            "retrieval=none,difficulty=quality,continuity="
        )

        def emitted(profile_id: str) -> list[dict]:
            messages = profile_warnings(parse_profile_id(profile_id))
            self.assertTrue(messages, f"engine said nothing for {profile_id}")
            output = io.StringIO()
            reporter = worker.FinokaReporter()
            with contextlib.redirect_stdout(output):
                for message in messages:
                    reporter.warning("routing-profile", message)
            return [json.loads(line) for line in output.getvalue().splitlines()]

        self.assertEqual(emitted(vector + "serial"), [])
        parallel = emitted(vector + "parallel")
        self.assertEqual([event["type"] for event in parallel], ["warning"])
        self.assertIn("continuity=parallel", parallel[0]["payload"]["message"])

    def test_normalize_engine_device(self) -> None:
        self.assertEqual(worker._normalize_engine_device("cuda:0"), ("cuda", "0"))
        self.assertEqual(worker._normalize_engine_device("cuda:1"), ("cuda", "1"))
        self.assertEqual(worker._normalize_engine_device("cuda"), ("cuda", None))
        self.assertEqual(worker._normalize_engine_device("cpu"), ("cpu", None))
        self.assertEqual(worker._normalize_engine_device(None), ("cuda", None))


if __name__ == "__main__":
    unittest.main()
