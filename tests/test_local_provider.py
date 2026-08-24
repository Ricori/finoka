from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from finoka.local_provider import LocalProvider, ProviderError
from finoka.sidecar import SidecarServer, session_authorized


def wait_state(provider: LocalProvider, task_id: str, expected: set[str], timeout: float = 5) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = provider.status(task_id)
        if snapshot["state"] in expected:
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"task did not reach {expected}: {provider.status(task_id)}")


def wait_progress(provider: LocalProvider, task_id: str, timeout: float = 5) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        snapshot = provider.status(task_id)
        if snapshot["progress"] is not None:
            return snapshot
        time.sleep(0.02)
    raise AssertionError(f"task did not report progress: {provider.status(task_id)}")


class LocalProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / "video.mp4"
        self.source.write_bytes(b"fixture")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def command(self, _task_id: str, task_dir: Path) -> list[str]:
        return [sys.executable, str(ROOT / "tests/fake_provider_worker.py"), "--task-dir", str(task_dir)]

    def provider(self) -> LocalProvider:
        return LocalProvider(
            self.root / "tasks",
            ROOT / "third_party/finesub",
            worker_command=self.command,
            issues=[],
        )

    def request(self, mode: str = "success") -> dict:
        return {
            "schema": 1,
            "provider": "local",
            "source": {"kind": "local_file", "path": str(self.source), "title": mode},
            "target": "raw-srt",
            "language": "ja",
            "device": "cuda",
            "gpu_budget_gb": 8,
            "correction": {"enabled": False, "media": "audio"},
            "knowledge": "none",
            "cleanup_intermediate": False,
        }

    def test_success_persists_monotonic_events_and_artifacts(self) -> None:
        provider = self.provider()
        task = provider.start(self.request())
        completed = wait_state(provider, task["task_id"], {"completed"})
        page = provider.events(task["task_id"])
        cursors = [event["cursor"] for event in page["events"]]
        self.assertEqual(cursors, list(range(1, len(cursors) + 1)))
        self.assertEqual(completed["stage"], "stable")
        self.assertIn("stable_json", provider.artifacts(task["task_id"])["artifacts"])
        provider.shutdown()

    def test_task_list_recovers_persisted_source_metadata(self) -> None:
        provider = self.provider()
        request = self.request()
        request["source"].update({"video_id": "loc_0123456789ab", "title": "迁移测试"})
        task = provider.start(request)
        wait_state(provider, task["task_id"], {"completed"})
        listing = provider.list_tasks()
        self.assertEqual(listing["schema"], 1)
        self.assertEqual(listing["tasks"][0]["snapshot"]["task_id"], task["task_id"])
        self.assertEqual(listing["tasks"][0]["media_id"], "loc_0123456789ab")
        self.assertEqual(listing["tasks"][0]["title"], "迁移测试")
        provider.shutdown()

    def test_completed_task_projects_and_saves_edit_document(self) -> None:
        provider = self.provider()
        request = self.request()
        request["source"].update({
            "video_id": "loc_0123456789ab",
            "fingerprint": "fingerprint",
            "duration": 1,
        })
        task = provider.start(request)
        wait_state(provider, task["task_id"], {"completed"})
        document = provider.document("loc_0123456789ab")
        self.assertEqual(document["subtitles"][0]["ja"], "fixture")
        saved = provider.save_document(
            "loc_0123456789ab",
            {"rev": document["rev"], "subtitles": [{**document["subtitles"][0], "ja": "edited"}]},
        )
        self.assertEqual(saved["rev"], 1)
        self.assertEqual(saved["subtitles"][0]["ja"], "edited")
        provider.shutdown()

    def test_failure_has_stable_error_code(self) -> None:
        provider = self.provider()
        task = provider.start(self.request("fail"))
        failed = wait_state(provider, task["task_id"], {"failed"})
        self.assertEqual(failed["error"]["code"], "missing_llm_key")

    def test_cancel_and_resume_interrupted_task(self) -> None:
        provider = self.provider()
        slow = provider.start(self.request("slow"))
        wait_state(provider, slow["task_id"], {"running"})
        self.assertEqual(provider.cancel(slow["task_id"])["state"], "cancelled")

        resumable = provider.start(self.request("resume"))
        wait_state(provider, resumable["task_id"], {"running"})
        wait_progress(provider, resumable["task_id"])
        provider.shutdown()
        self.assertEqual(provider.status(resumable["task_id"])["state"], "interrupted")
        provider.resume(resumable["task_id"])
        self.assertEqual(wait_state(provider, resumable["task_id"], {"completed"})["state"], "completed")

    def test_invalid_source_is_rejected_before_worker_start(self) -> None:
        provider = self.provider()
        request = self.request()
        request["source"]["path"] = "relative.mp4"
        with self.assertRaisesRegex(ProviderError, "absolute") as raised:
            provider.start(request)
        self.assertEqual(raised.exception.code, "invalid_source")

    def test_loopback_server_requires_session_token(self) -> None:
        provider = self.provider()
        self.assertFalse(session_authorized("", "secret-token"))
        self.assertFalse(session_authorized("Bearer wrong", "secret-token"))
        self.assertTrue(session_authorized("Bearer secret-token", "secret-token"))
        try:
            server = SidecarServer(("127.0.0.1", 0), provider, "secret-token")
        except PermissionError:
            provider.shutdown()
            self.skipTest("sandbox does not permit a loopback listener")
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/v1/capabilities"
        try:
            with self.assertRaises(urllib.error.HTTPError) as raised:
                urllib.request.urlopen(url, timeout=2)
            self.assertEqual(raised.exception.code, 401)
            request = urllib.request.Request(url, headers={"Authorization": "Bearer secret-token"})
            with urllib.request.urlopen(request, timeout=2) as response:
                body = json.load(response)
            self.assertEqual(body["provider"], "local")
        finally:
            server.shutdown()
            server.server_close()
            provider.shutdown()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
