"""Generate the editor waveform from local media with bounded memory."""

from __future__ import annotations

import math
import shutil
import struct
import subprocess
from pathlib import Path
from typing import Any


SAMPLE_RATE = 16_000
PEAKS_PER_SECOND = 20
MAX_BUCKETS = 60_000


def bucket_peak(raw: bytes) -> float:
    usable = len(raw) // 2 * 2
    if usable == 0:
        return 0.0
    values = struct.iter_unpack("<h", raw[:usable])
    peak = max(abs(value[0]) for value in values)
    return round(peak / 32768.0, 3)


def generate_peaks(source: str | Path, duration: float, *, executable: str | Path | None = None) -> dict[str, Any]:
    executable = str(executable) if executable else shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError("ffmpeg is required to generate waveform peaks")
    duration = max(0.0, float(duration or 0))
    bucket = SAMPLE_RATE // PEAKS_PER_SECOND
    if duration > 0:
        target = min(MAX_BUCKETS, max(1, int(duration * PEAKS_PER_SECOND)))
        bucket = max(1, math.ceil(duration * SAMPLE_RATE / target))
    command = [
        executable, "-v", "error", "-i", str(Path(source)), "-vn", "-ac", "1",
        "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert process.stdout is not None
    peaks: list[float] = []
    size = bucket * 2
    while True:
        raw = process.stdout.read(size)
        if not raw:
            break
        peaks.append(bucket_peak(raw))
    _, stderr = process.communicate()
    if process.returncode != 0:
        raise RuntimeError(stderr.decode("utf-8", errors="replace").strip() or "ffmpeg waveform generation failed")
    if not peaks:
        raise RuntimeError("media has no usable audio samples")
    actual_duration = duration or len(peaks) / PEAKS_PER_SECOND
    return {
        "per_sec": round(len(peaks) / actual_duration, 3),
        "duration": round(actual_duration, 3),
        "peaks": peaks,
    }
