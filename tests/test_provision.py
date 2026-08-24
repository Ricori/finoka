from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from finoka.provision import RuntimeProvisionError, RuntimeProvisioner


VENDOR = Path(__file__).resolve().parents[1] / "third_party" / "finesub"


def test_runtime_provision_status_uses_finesub_manifests(tmp_path: Path) -> None:
    provisioner = RuntimeProvisioner(tmp_path, VENDOR)
    status = provisioner.status()
    assert status["schema"] == 1
    assert status["root"].startswith(str(tmp_path))
    resource_ids = {item["id"] for item in status["resources"]}
    assert "ffmpeg" in resource_ids
    if sys.platform == "darwin":
        assert status["media_supported"] is True
        assert "ffprobe" in resource_ids
    else:
        assert "uv" in resource_ids
    assert {item["id"] for item in status["models"]} == {"separator", "whisper", "qwen-referee"}


@pytest.mark.skipif(sys.platform == "win32", reason="non-Windows platform gate")
def test_runtime_install_refuses_unsupported_platform(tmp_path: Path) -> None:
    provisioner = RuntimeProvisioner(tmp_path, VENDOR)
    assert provisioner.status()["supported"] is False
    with pytest.raises(RuntimeProvisionError, match="Windows x64"):
        provisioner.start("all")


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS managed media resources")
def test_macos_manifests_pin_both_media_tools() -> None:
    resource_root = Path(__file__).resolve().parents[1] / "src" / "finoka" / "resources"
    for architecture in ("arm64", "amd64"):
        manifest = json.loads(
            (resource_root / f"runtime-manifest.macos-{architecture}.json").read_text(encoding="utf-8")
        )
        resources = {item["id"]: item for item in manifest["resources"]}
        assert set(resources) == {"ffmpeg", "ffprobe"}
        for item in resources.values():
            assert item["asset"]["size"] > 0
            assert len(item["asset"]["sha256"]) == 64


@pytest.mark.skipif(sys.platform != "darwin", reason="macOS managed media resources")
def test_macos_managed_tools_are_added_to_worker_path(tmp_path: Path) -> None:
    provisioner = RuntimeProvisioner(tmp_path, VENDOR)
    assert provisioner.resources is not None
    for name in ("ffmpeg", "ffprobe"):
        destination = provisioner.resources.install_path(name) / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"fixture")
        destination.chmod(0o755)
        (destination.parent.parent / "current.json").write_text('{"current":"9.0.1"}', encoding="utf-8")
        assert provisioner.tool_path(name) == destination
    path_entries = provisioner.worker_environment()["PATH"].split(os.pathsep)
    assert str(provisioner.tool_path("ffmpeg").parent) in path_entries
    assert str(provisioner.tool_path("ffprobe").parent) in path_entries


def test_runtime_progress_can_aggregate_multiple_resource_downloads(tmp_path: Path) -> None:
    provisioner = RuntimeProvisioner(tmp_path, VENDOR)

    class Progress:
        total = 40
        downloaded = 15
        bytes_per_second = 1024.0

    provisioner._progress(Progress(), completed_before=40, total_override=100)
    progress = provisioner.status()["job"]["progress"]
    assert progress == {
        "completed": 55,
        "total": 100,
        "unit": "bytes",
        "bytes_per_second": 1024.0,
    }
