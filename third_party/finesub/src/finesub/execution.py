"""Execution-profile switch for shared local and cloud engine bundles."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import os
from typing import Callable, Iterator, TypeVar


EXECUTION_PROFILE_ENV = "FINESUB_EXECUTION_PROFILE"
EXECUTION_PROFILE_LOCAL = "local"
EXECUTION_PROFILE_CLOUD = "cloud"
EXECUTION_PROFILES = (EXECUTION_PROFILE_LOCAL, EXECUTION_PROFILE_CLOUD)

_PROFILE: ContextVar[str | None] = ContextVar("finesub_execution_profile", default=None)
_Function = TypeVar("_Function", bound=Callable)


def normalize_execution_profile(value: str | None = None) -> str:
    """Resolve an explicit/context/environment profile, defaulting to local."""

    resolved = value
    if resolved is None:
        resolved = _PROFILE.get()
    if resolved is None:
        resolved = os.environ.get(EXECUTION_PROFILE_ENV, EXECUTION_PROFILE_LOCAL)
    normalized = str(resolved).strip().lower()
    if normalized not in EXECUTION_PROFILES:
        expected = ", ".join(EXECUTION_PROFILES)
        raise ValueError(
            f"unsupported execution profile {resolved!r}; expected {expected}"
        )
    return normalized


def cloud_execution_enabled(value: str | None = None) -> bool:
    return normalize_execution_profile(value) == EXECUTION_PROFILE_CLOUD


@contextmanager
def execution_profile_scope(value: str | None = None) -> Iterator[str]:
    resolved = normalize_execution_profile(value)
    token = _PROFILE.set(resolved)
    try:
        yield resolved
    finally:
        _PROFILE.reset(token)


def execution_profiled(function: _Function) -> _Function:
    """Run a keyword-profiled public entry point inside its profile context."""

    @wraps(function)
    def wrapped(*args, **kwargs):
        with execution_profile_scope(kwargs.get("execution_profile")):
            return function(*args, **kwargs)

    return wrapped  # type: ignore[return-value]
