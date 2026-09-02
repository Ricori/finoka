"""Records must survive a reader holding the file they are replacing.

Every task record here is written the same way: a temp file, then `os.replace`
onto the name. On Windows that replace is denied while anything holds either
name open, and Python's `open` does not share deletion -- so the desktop UI
reading `snapshot.json` denies the worker writing it. The record had been
written correctly; only the swap failed, and the task died with
`[WinError 5] 拒绝访问`.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from nonoka_x import document_store
from nonoka_x.document_store import _atomic_json


def test_a_reader_that_lets_go_does_not_fail_the_write(tmp_path: Path) -> None:
    """The real thing, no mocks: a held handle, then the same write again."""

    path = tmp_path / "snapshot.json"
    _atomic_json(path, {"state": "running"})

    handle = path.open(encoding="utf-8")
    handle.read()
    released = threading.Timer(0.12, handle.close)
    released.start()
    try:
        _atomic_json(path, {"state": "completed"})
    finally:
        released.cancel()
        handle.close()

    assert json.loads(path.read_text(encoding="utf-8")) == {"state": "completed"}


def test_the_wait_is_bounded_and_leaves_no_temp_file(tmp_path: Path, monkeypatch) -> None:
    """A name nobody ever lets go of still fails, and fails clean.

    Bounded because these records are rewritten on every status update: a
    permanently locked name must not make each later write pay the full wait.
    """

    slept: list[float] = []
    monkeypatch.setattr(document_store.time, "sleep", slept.append)

    def denied(source, destination):
        raise PermissionError(5, "Access is denied")

    monkeypatch.setattr(document_store.os, "replace", denied)

    with pytest.raises(PermissionError):
        _atomic_json(tmp_path / "snapshot.json", {"state": "running"})

    assert len(slept) == document_store._REPLACE_ATTEMPTS - 1
    assert sum(slept) < 1.0
    assert list(tmp_path.iterdir()) == []


def test_the_swap_is_still_atomic_for_readers(tmp_path: Path) -> None:
    """Retrying must not turn the write into a truncate-then-fill.

    A reader that arrives mid-write has to see the old record or the new one,
    which is the whole reason for the temp file. The reader here polls the way
    the desktop UI does, with a pause between reads: a reader that instead
    spins with no pause holds a handle essentially always, and no bounded wait
    can outlast it -- that is a starved writer, not a torn record, and it is
    not what this file claims to fix.
    """

    path = tmp_path / "snapshot.json"
    _atomic_json(path, {"state": "running", "last_cursor": 0})

    seen: list[dict] = []
    stop = threading.Event()

    def read_until_stopped() -> None:
        while not stop.is_set():
            try:
                seen.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError):  # a torn read is the failure, not this
                pass
            time.sleep(0.005)

    reader = threading.Thread(target=read_until_stopped, daemon=True)
    reader.start()
    try:
        for cursor in range(1, 60):
            _atomic_json(path, {"state": "running", "last_cursor": cursor})
    finally:
        stop.set()
        reader.join(timeout=5)

    assert seen, "the reader never managed a read"
    assert all(record["state"] == "running" for record in seen)
    assert all(isinstance(record["last_cursor"], int) for record in seen)


@pytest.mark.skipif(os.name != "nt", reason="the denial this guards is Windows-only")
def test_windows_really_does_deny_a_replace_under_a_reader(tmp_path: Path) -> None:
    """Pins the mechanism, so the retry above cannot look like cargo cult."""

    target = tmp_path / "snapshot.json"
    target.write_text("{}", encoding="utf-8")
    temporary = tmp_path / "next.tmp"
    temporary.write_text('{"state": "completed"}', encoding="utf-8")

    with target.open(encoding="utf-8") as reader:
        reader.read()
        with pytest.raises(PermissionError):
            os.replace(temporary, target)


def test_a_reader_racing_a_swap_is_not_denied(tmp_path: Path) -> None:
    """The mirror of the write retry, and the flake it actually fixed.

    `os.replace` never shows a reader a torn record, but on Windows it does
    make the name unopenable for the instant the swap takes -- so a reader
    that merely arrives at the wrong moment was denied outright. Reading
    through `_read_json_when_free` waits that instant out instead. Before the
    retry this failed roughly one run in three; the writer here rewrites the
    record as fast as it can, so the instant comes up constantly.
    """

    path = tmp_path / "snapshot.json"
    _atomic_json(path, {"state": "running", "last_cursor": 0})

    stop = threading.Event()
    writer_failed: list[BaseException] = []

    def write_until_stopped() -> None:
        cursor = 0
        try:
            while not stop.is_set():
                cursor += 1
                _atomic_json(path, {"state": "running", "last_cursor": cursor})
        except BaseException as error:  # noqa: BLE001 - reported, not swallowed
            writer_failed.append(error)

    writer = threading.Thread(target=write_until_stopped, daemon=True)
    writer.start()
    try:
        seen = [document_store._read_json_when_free(path) for _ in range(300)]
    finally:
        stop.set()
        writer.join(timeout=5)

    assert not writer_failed, f"the writer lost the race instead: {writer_failed[0]!r}"
    assert all(record["state"] == "running" for record in seen)
    assert all(isinstance(record["last_cursor"], int) for record in seen)


def test_the_read_wait_is_bounded_and_outlasts_the_writer(tmp_path: Path, monkeypatch) -> None:
    """A name that is never free still fails, and fails quickly.

    The budget has to outlast the writer's: a writer that is itself retrying
    denies the name once per attempt, so a reader on the same budget could
    give up in step with it and turn a won race into a lost one.
    """

    slept: list[float] = []
    monkeypatch.setattr(document_store.time, "sleep", slept.append)

    path = tmp_path / "snapshot.json"
    _atomic_json(path, {"state": "running"})

    def denied(*args, **kwargs):
        raise PermissionError(13, "Permission denied")

    monkeypatch.setattr(Path, "read_text", denied)

    with pytest.raises(PermissionError):
        document_store._read_json_when_free(path)

    assert len(slept) == document_store._READ_ATTEMPTS - 1
    assert sum(slept) > sum(
        document_store._REPLACE_BACKOFF_SECONDS * attempt
        for attempt in range(1, document_store._REPLACE_ATTEMPTS)
    )
    assert sum(slept) < 1.0


def test_a_missing_record_is_answered_at_once(tmp_path: Path, monkeypatch) -> None:
    """A name that was never there is not a race, and must not be waited on.

    `LocalProvider.status` turns this into "no such task"; making that answer
    pay the retry budget would slow every lookup of a task that does not exist.
    """

    slept: list[float] = []
    monkeypatch.setattr(document_store.time, "sleep", slept.append)

    with pytest.raises(FileNotFoundError):
        document_store._read_json_when_free(tmp_path / "absent.json")

    assert slept == []
