from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace

from finoka.model_install import ByteProgressReporter, _install_huggingface, emit_event


def test_model_byte_reporter_emits_bounded_percentage_inputs() -> None:
    events: list[dict] = []
    reporter = ByteProgressReporter("whisper", 100, events.append)

    reporter.update(0, force=True)
    reporter.update(125, force=True)

    assert events[0]["completed"] == 0
    assert events[-1]["completed"] == 100
    assert events[-1]["total"] == 100
    assert events[-1]["unit"] == "bytes"
    assert events[-1]["bytes_per_second"] >= 0


def test_model_event_wire_format_is_ascii_safe(capsys) -> None:
    emit_event({"type": "stage", "resource": "whisper", "message": "正在下载模型：whisper"})

    output = capsys.readouterr().out.strip()
    output.encode("ascii")
    assert "\\u6b63\\u5728" in output


def test_huggingface_download_reports_dry_run_total(monkeypatch, tmp_path) -> None:
    module = ModuleType("huggingface_hub")
    calls: list[dict] = []

    def snapshot_download(**kwargs):
        calls.append(kwargs)
        if kwargs.get("dry_run"):
            return [SimpleNamespace(file_size=100, will_download=True)]
        bar = kwargs["tqdm_class"](total=100, desc="Downloading bytes")
        bar.update(40)
        bar.update(60)
        bar.close()
        return str(tmp_path / "snapshot")

    module.snapshot_download = snapshot_download
    monkeypatch.setitem(sys.modules, "huggingface_hub", module)
    events: list[dict] = []

    snapshot = _install_huggingface(
        SimpleNamespace(repo="owner/model", revision="abc123"),
        "whisper",
        tmp_path,
        events.append,
    )

    assert snapshot == tmp_path / "snapshot"
    assert calls[0]["dry_run"] is True
    progress = [event for event in events if event["type"] == "progress"]
    assert progress[-1]["completed"] == 100
    assert progress[-1]["total"] == 100
