"""Observable installation of the large wheels in FineSub's runtime lock."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
import tomllib
from typing import Any
from urllib.parse import unquote, urlparse

from finesub_bootstrap.downloader import (
    DigestMismatch,
    DownloadPaused,
    SizeMismatch,
    download_asset,
)
from finesub_bootstrap.environment import (
    RuntimeEnvironment,
    _is_retryable_from_mirror,
)
from finesub_bootstrap.models import DownloadAsset, DownloadProgress


# PyTorch's package index does not publish wheel sizes, so uv cannot put them
# into the generated PEP 751 lock. The digest still pins immutable bytes; this
# table supplies the matching Content-Length so FineSub's resumable downloader
# can report real progress and reject truncated downloads.
KNOWN_WHEEL_SIZES = {
    "7c78215c3af4f62e63f2b2e360f1722fc719b0853c7ac22666483d9810613a4c": 2_753_189_216,
}
LARGE_WHEEL_THRESHOLD = 256 * 1024 * 1024

ProgressCallback = Callable[[DownloadProgress], None]


@dataclass(frozen=True, slots=True)
class LockedWheel:
    package: str
    filename: str
    url: str
    size: int
    sha256: str


def large_wheels_from_lock(lock: Path) -> list[LockedWheel]:
    """Return locked wheels large enough to benefit from explicit progress."""

    body = tomllib.loads(lock.read_text(encoding="utf-8"))
    result: list[LockedWheel] = []
    for package in body.get("packages", []):
        if not isinstance(package, dict):
            continue
        package_name = str(package.get("name") or "")
        for wheel in package.get("wheels", []):
            if not isinstance(wheel, dict):
                continue
            hashes = wheel.get("hashes")
            if not isinstance(hashes, dict):
                continue
            sha256 = str(hashes.get("sha256") or "").lower()
            size_value = wheel.get("size", KNOWN_WHEEL_SIZES.get(sha256, 0))
            size = int(size_value) if isinstance(size_value, int) else 0
            url = str(wheel.get("url") or "")
            filename = Path(unquote(urlparse(url).path)).name
            if size < LARGE_WHEEL_THRESHOLD or not url or not filename:
                continue
            result.append(
                LockedWheel(
                    package=package_name,
                    filename=filename,
                    url=url,
                    size=size,
                    sha256=sha256,
                )
            )
    return result


def _format_size(size: int) -> str:
    return f"{size / 1024**3:.1f} GiB" if size >= 1024**3 else f"{size / 1024**2:.0f} MiB"


class ProgressRuntimeEnvironment(RuntimeEnvironment):
    """Prefetch very large wheels with byte progress before invoking uv."""

    def __init__(self, *, download_progress: ProgressCallback, **values: Any) -> None:
        super().__init__(**values)
        self.download_progress = download_progress

    def _install_dependencies(
        self,
        uv: Path,
        staging_python: Path,
        environment: dict[str, str],
        *,
        log,
        should_pause,
    ) -> None:
        regional = self.regional_lock()
        selected = regional or self.runtime_lock
        try:
            local_wheels = self._prefetch_large_wheels(
                selected,
                stage_message=(
                    "正在从中国大陆镜像下载 {package}（{size}）"
                    if regional is not None
                    else "正在下载 {package}（{size}）"
                ),
                should_pause=should_pause,
            )
        except Exception as error:
            mirror_can_retry = isinstance(error, (DigestMismatch, SizeMismatch)) or _is_retryable_from_mirror(error)
            if regional is None or isinstance(error, DownloadPaused) or not mirror_can_retry:
                raise
            if log is not None:
                log(f"镜像下载失败，改用官方源重试：{error}")
            from finesub_bootstrap.download_routes import record_failure

            record_failure(self.paths.data_root, "pypi")
            local_wheels = self._prefetch_large_wheels(
                self.runtime_lock,
                stage_message="正在从官方源下载 {package}（{size}）",
                should_pause=should_pause,
            )

        if local_wheels:
            if self._progress_stage is not None:
                self._progress_stage(
                    "installing_dependencies",
                    "大型依赖下载完成，正在安装到隔离环境",
                )
            self._run(
                [
                    str(uv),
                    "pip",
                    "install",
                    "--python",
                    str(staging_python),
                    "--no-deps",
                    *(str(path) for path in local_wheels),
                ],
                environment,
                log=log,
                should_pause=should_pause,
            )

        try:
            super()._install_dependencies(
                uv,
                staging_python,
                environment,
                log=log,
                should_pause=should_pause,
            )
        except Exception:
            # Keep completed wheels after a later dependency failure so retrying
            # does not spend another multi-gigabyte download.
            raise
        else:
            # uv now owns an extracted cache entry. The source wheel is no
            # longer needed and retaining it would cost another 2.6 GiB.
            for wheel in local_wheels:
                wheel.unlink(missing_ok=True)

    def _prefetch_large_wheels(
        self,
        lock: Path,
        *,
        stage_message: str,
        should_pause,
    ) -> list[Path]:
        wheels = large_wheels_from_lock(lock)
        if not wheels:
            return []

        total = sum(wheel.size for wheel in wheels)
        completed_before = 0
        destinations: list[Path] = []
        for wheel in wheels:
            if should_pause is not None and should_pause():
                raise DownloadPaused("Python environment installation paused")
            if destinations:
                completed_before += wheels[len(destinations) - 1].size
            message = stage_message.format(
                package=wheel.package,
                size=_format_size(wheel.size),
            )
            # RuntimeEnvironment's public stage callback is supplied by the
            # provisioner; use it directly so the UI switches back to download.
            # It is temporarily attached for this call by install().
            if self._progress_stage is not None:
                self._progress_stage("downloading", message)

            before = completed_before

            def report(value: DownloadProgress, *, offset: int = before) -> None:
                self.download_progress(
                    DownloadProgress(
                        downloaded=offset + value.downloaded,
                        total=total,
                        bytes_per_second=value.bytes_per_second,
                    )
                )

            destination = (
                self.paths.cache
                / "runtime-wheels"
                / wheel.sha256
                / wheel.filename
            )
            download_asset(
                DownloadAsset(
                    url=wheel.url,
                    size=wheel.size,
                    sha256=wheel.sha256,
                ),
                destination,
                report,
                should_pause,
            )
            destinations.append(destination)
        return destinations

    def install(self, *, stage=None, log=None, should_pause=None):
        self._progress_stage = stage
        try:
            return super().install(
                stage=stage,
                log=log,
                should_pause=should_pause,
            )
        finally:
            self._progress_stage = None
