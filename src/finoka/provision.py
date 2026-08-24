"""FineSub-native managed runtime and model provisioning for the desktop sidecar."""

from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

TARGETS = {"media", "runtime", "models", "all"}
PIPELINE_MODELS = ("separator", "whisper", "qwen-referee")


class RuntimeProvisionError(RuntimeError):
    pass


class RuntimeProvisioner:
    """Own one asynchronous FineSub provisioning operation.

    FineSub's bootstrap remains the authority for downloads, hashes, safe
    extraction, mirrors and the Python lock. Finoka only exposes its state to
    Wails and selects the resulting interpreter for workers.
    """

    def __init__(self, data_dir: str | Path, vendor: str | Path) -> None:
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.vendor = Path(vendor).expanduser().resolve()
        self.platform = self._platform_id()
        self._runtime_supported = sys.platform == "win32"
        self._media_supported = self.platform in {"windows-x64", "macos-amd64", "macos-arm64"}
        install_root = self.data_dir / "finesub"
        self._bootstrap_error = ""
        self.runtime = None
        try:
            from finesub_bootstrap.paths import AppPaths
            from finesub_bootstrap.resources import ResourceManager
            from finesub_bootstrap.shell import resource_specs

            self.paths = AppPaths.for_root(
                install_root,
                data_root=self.data_dir / "finesub-data",
                big_data=install_root,
            )
            if self.platform in {"macos-arm64", "macos-amd64"}:
                manifest_path = Path(__file__).resolve().parent / "resources" / self._manifest_name()
            else:
                manifest_path = self.vendor / "resources" / self._manifest_name()
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.resources = ResourceManager(self.paths, resource_specs(manifest))
        except Exception as exc:
            self.paths = None
            self.resources = None
            self.runtime = None
            self._bootstrap_error = f"{type(exc).__name__}: {exc}"

        if not self._bootstrap_error and self._runtime_supported:
            from finesub_bootstrap.environment import RuntimeEnvironment

            def managed_uv() -> Path:
                assert self.resources is not None
                executable = self.resources.active_file("uv", "uv.exe")
                if executable is None:
                    raise FileNotFoundError("FineSub uv bootstrap resource is not installed")
                return executable

            self.runtime = RuntimeEnvironment(
                paths=self.paths,
                app_source=self.vendor,
                runtime_lock=self.vendor / "runtime" / "pylock.win-py312.toml",
                uv_executable=managed_uv,
            )
        self._lock = threading.RLock()
        self._job: dict[str, Any] = {
            "state": "idle",
            "target": "",
            "resource": "",
            "stage": "",
            "message": "",
            "progress": None,
            "error": None,
        }

    @staticmethod
    def _platform_id() -> str:
        if sys.platform == "win32":
            return "windows-x64"
        if sys.platform == "darwin":
            machine = platform.machine().lower()
            if machine in {"arm64", "aarch64"}:
                return "macos-arm64"
            if machine in {"x86_64", "amd64"}:
                return "macos-amd64"
        return sys.platform

    def _manifest_name(self) -> str:
        if self.platform == "windows-x64":
            return "runtime-manifest.json"
        if self.platform == "macos-arm64":
            return "runtime-manifest.macos-arm64.json"
        if self.platform == "macos-amd64":
            return "runtime-manifest.macos-amd64.json"
        # Unsupported desktop platforms retain the Windows resource snapshot in
        # diagnostics, matching the historical status shape, but installation
        # remains blocked by the platform capability flags.
        return "runtime-manifest.json"

    def status(self) -> dict[str, Any]:
        if self._bootstrap_error:
            with self._lock:
                job = json.loads(json.dumps(self._job))
            return {
                "schema": 1,
                "platform": self.platform,
                "supported": False,
                "runtime_supported": False,
                "media_supported": False,
                "media_ready": False,
                "root": str(self.data_dir / "finesub"),
                "runtime": {"id": "python", "version": "3.12", "state": "missing", "detail": f"FineSub bootstrap 依赖缺失：{self._bootstrap_error}"},
                "resources": [],
                "models": [{"id": model_id, "state": "missing"} for model_id in PIPELINE_MODELS],
                "job": job,
            }
        assert self.resources is not None and self.paths is not None
        from finesub_bootstrap.model_caches import PIPELINE_MODEL_IDS, missing_pipeline_models

        resources = [item.model_dump(mode="json") for item in self.resources.check_all()]
        if self.runtime is not None:
            runtime_status = self.runtime.status().model_dump(mode="json")
        else:
            runtime_status = {
                "id": "python",
                "version": "3.12",
                "state": "missing",
                "detail": "本地 GPU 运行时当前仅支持 Windows x64/NVIDIA",
            }
        missing = list(missing_pipeline_models(self.paths.models))
        with self._lock:
            job = json.loads(json.dumps(self._job))
        return {
            "schema": 1,
            "platform": self.platform,
            "supported": self._runtime_supported,
            "runtime_supported": self._runtime_supported,
            "media_supported": self._media_supported,
            "media_ready": self.tool_path("ffmpeg") is not None and self.tool_path("ffprobe") is not None,
            "root": str(self.paths.root),
            "runtime": runtime_status,
            "resources": resources,
            "models": [
                {"id": model_id, "state": "missing" if model_id in missing else "ready"}
                for model_id in PIPELINE_MODEL_IDS
            ],
            "job": job,
        }

    def start(self, target: str) -> dict[str, Any]:
        if target not in TARGETS:
            raise RuntimeProvisionError("target must be media, runtime, models, or all")
        if target == "media" and not self._media_supported:
            raise RuntimeProvisionError(f"managed FFmpeg is unavailable on {self.platform}")
        if target != "media" and not self._runtime_supported:
            raise RuntimeProvisionError("FineSub managed GPU runtime currently supports Windows x64 only")
        if self._bootstrap_error:
            raise RuntimeProvisionError(f"FineSub bootstrap is unavailable: {self._bootstrap_error}")
        with self._lock:
            if self._job["state"] == "running":
                raise RuntimeProvisionError("FineSub runtime installation is already running")
            self._job = {
                "state": "running",
                "target": target,
                "resource": "",
                "stage": "preparing",
                "message": "正在准备 FFmpeg 下载" if target == "media" else "正在准备 FineSub 安装",
                "progress": None,
                "error": None,
            }
        thread = threading.Thread(target=self._run, args=(target,), name="finoka-runtime-provision", daemon=True)
        thread.start()
        return self.status()

    def _update(self, **values: Any) -> None:
        with self._lock:
            self._job.update(values)

    def _stage(self, stage: str, message: str, *, reset_progress: bool = True) -> None:
        values: dict[str, Any] = {"stage": stage, "message": message}
        if reset_progress:
            values["progress"] = None
        self._update(**values)

    def _progress(self, value: Any, *, completed_before: int = 0, total_override: int = 0) -> None:
        item_total = max(0, int(value.total))
        total = max(item_total, int(total_override))
        downloaded = max(0, int(value.downloaded)) + max(0, int(completed_before))
        if total:
            downloaded = min(downloaded, total)
        self._update(progress={"completed": downloaded, "total": total, "unit": "bytes", "bytes_per_second": value.bytes_per_second})

    def _run(self, target: str) -> None:
        try:
            assert self.paths is not None and self.resources is not None
            from finesub_bootstrap.model_caches import missing_pipeline_models
            from finesub_bootstrap.paths import ensure_store

            ensure_store(self.paths)
            if target == "media":
                self._install_media_tools()
            if target in {"runtime", "all"}:
                assert self.runtime is not None
                for resource_id in ("uv", "ffmpeg"):
                    if self.resources.status(resource_id).state != "ready":
                        self._stage("resource", f"正在安装 FineSub 资源：{resource_id}")
                        self.resources.install(resource_id, self._progress, stage=self._stage)
                if self.runtime.status().state != "ready":
                    self._stage("runtime", "正在安装 FineSub Python/CUDA 运行时")
                    self.runtime.install(stage=self._stage, log=lambda line: self._update(message=line))
            if target in {"models", "all"}:
                assert self.runtime is not None
                if self.runtime.status().state != "ready":
                    raise RuntimeProvisionError("请先安装 FineSub Python 运行时")
                for model_id in missing_pipeline_models(self.paths.models):
                    self._install_model(model_id)
            message = "FFmpeg 与 FFprobe 已准备就绪" if target == "media" else "FineSub 运行时与所选资源已准备就绪"
            self._update(state="completed", stage="completed", message=message, progress=None)
        except Exception as exc:
            self._update(state="failed", stage="failed", message=str(exc), error={"code": "runtime_install_failed", "message": str(exc)}, progress=None)

    def _install_media_tools(self) -> None:
        assert self.resources is not None
        resource_ids = ("ffmpeg",) if self.platform == "windows-x64" else ("ffmpeg", "ffprobe")
        pending = [resource_id for resource_id in resource_ids if self.resources.status(resource_id).state != "ready"]
        sizes = {
            resource_id: max(0, int(getattr(self.resources.resources[resource_id].asset, "size", 0)))
            for resource_id in pending
        }
        total = sum(sizes.values())
        completed_before = 0
        for resource_id in pending:
            self._update(resource=resource_id, stage="resource", message=f"正在准备 {resource_id}", progress=None)

            def resource_stage(stage: str, message: str, *, current: str = resource_id) -> None:
                with self._lock:
                    progress = self._job.get("progress")
                    if stage != "downloading" and isinstance(progress, dict):
                        progress = {**progress, "bytes_per_second": 0.0}
                    self._job.update(stage=stage, message=f"{current}：{message}", progress=progress)

            def resource_progress(value: Any, *, before: int = completed_before) -> None:
                self._progress(value, completed_before=before, total_override=total)

            self.resources.install(resource_id, resource_progress, stage=resource_stage)
            completed_before += sizes[resource_id]
        for tool in ("ffmpeg", "ffprobe"):
            executable = self.tool_path(tool)
            if executable is None:
                raise RuntimeProvisionError(f"{tool} 安装完成后仍不可用")
            if os.name != "nt":
                executable.chmod(executable.stat().st_mode | 0o755)

    def _install_model(self, model_id: str) -> None:
        assert self.paths is not None and self.runtime is not None
        self._stage("model", f"正在下载并校验 FineSub 模型：{model_id}")
        environment = self.worker_environment()
        project_src = Path(__file__).resolve().parents[1]
        python_paths = [str(project_src), str(self.vendor / "src")]
        if environment.get("PYTHONPATH"):
            python_paths.append(environment["PYTHONPATH"])
        environment["PYTHONPATH"] = os.pathsep.join(python_paths)
        result = subprocess.run(
            [
                str(self.runtime.python_executable), "-m", "finoka.model_install",
                "--model", model_id,
                "--models-root", str(self.paths.models),
                "--data-root", str(self.paths.data_root),
            ],
            cwd=self.vendor,
            env=environment,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip()
            raise RuntimeProvisionError(detail[-4000:] or f"model installer exited with {result.returncode}")

    def worker_python(self) -> Path | None:
        if self.runtime is None:
            return None
        return self.runtime.python_executable if self.runtime.status().state == "ready" else None

    def tool_path(self, name: str) -> Path | None:
        if self.resources is None or name not in {"ffmpeg", "ffprobe", "git", "tokcount"}:
            return None
        filename = f"{name}.exe" if os.name == "nt" else name
        resource_ids = (name, "ffmpeg") if name == "ffprobe" else (name,)
        for resource_id in resource_ids:
            if resource_id not in self.resources.resources:
                continue
            executable = self.resources.active_file(resource_id, filename)
            if executable is not None:
                return executable
        return None

    def worker_environment(self) -> dict[str, str]:
        environment = os.environ.copy()
        if self.paths is None or self.resources is None:
            return environment
        environment.update({
            "FINESUB_MODEL_DIR": str(self.paths.models),
            "HF_HOME": str(self.paths.models / "huggingface"),
            "TORCH_HOME": str(self.paths.models / "torch"),
            "UV_CACHE_DIR": str(self.paths.cache / "uv"),
        })
        path_dirs: list[str] = []
        for name in ("ffmpeg", "ffprobe", "git", "tokcount"):
            executable = self.tool_path(name)
            if executable is not None:
                path_dirs.append(str(executable.parent))
        if path_dirs:
            environment["PATH"] = os.pathsep.join([*path_dirs, environment.get("PATH", "")])
        return environment
