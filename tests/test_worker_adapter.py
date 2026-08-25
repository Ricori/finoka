from __future__ import annotations

import contextlib
import io
import json
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
                for name, value in previous.items():
                    if value is None:
                        sys.modules.pop(name, None)
                    else:
                        sys.modules[name] = value
            self.assertEqual(result, 0)
            self.assertEqual(captured["input"], str(source))
            self.assertEqual(captured["stage"], "raw-srt")
            self.assertEqual(captured["device"], "cuda:0")
            self.assertEqual(captured["execution_profile"], "local")
            self.assertTrue(captured["resume"])
            events = [json.loads(line) for line in output.getvalue().splitlines()]
            completed = next(event for event in events if event["type"] == "completed")
            manifest = completed["payload"]["artifacts"]
            self.assertEqual(manifest["engine_commit"], "2a320ede3f5c29e431a4525aab01d97945f349c2")
            self.assertEqual(set(manifest["artifacts"]), {"stable_json", "raw_srt"})
            self.assertEqual(len(manifest["artifacts"]["stable_json"]["sha256"]), 64)


if __name__ == "__main__":
    unittest.main()
