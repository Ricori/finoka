"""Small, dependency-free decisions controlled by the execution profile."""

from __future__ import annotations

from collections.abc import Mapping

from .execution import cloud_execution_enabled


def refine_compute_type(device: str) -> str:
    """Choose CTranslate2 precision without importing the ASR runtime."""

    if device.strip().lower().startswith("cuda"):
        return "float16"
    # The cloud CTranslate2 build intentionally omits an SGEMM library; int8
    # uses the compiled RUY backend. Local keeps upstream's float32 behavior.
    return "int8" if cloud_execution_enabled() else "float32"


def separator_sample_rate(
    vocal_profile: str,
    sample_rates: Mapping[str, int],
) -> int | None:
    """Return an explicit cloud rate; local omits the dependency keyword."""

    if not cloud_execution_enabled():
        return None
    return sample_rates[vocal_profile]
