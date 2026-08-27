from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.sync_finesub import (
    DEFAULT_VENDOR,
    create_files_manifest,
    git_apply_command,
    git_apply_env,
)


ROOT = Path(__file__).resolve().parents[1]
PATCH_ROOT = ROOT / "patches" / "finesub"
BASELINE_MANIFEST = PATCH_ROOT / "BASELINE_FILES.json"


def _git_apply(root: Path, patch_path: Path, *, reverse: bool = False) -> None:
    # Same invocation the synchronizer uses, borrowed rather than restated:
    # line-ending translation and the surrounding repository both have to be
    # kept out of it, and a replay that differs from the real apply proves
    # nothing about the real apply.
    command = [*git_apply_command(), "--verbose"]
    if reverse:
        command.append("--reverse")
    command.append(str(patch_path))
    completed = subprocess.run(
        command,
        cwd=root,
        env=git_apply_env(root),
        capture_output=True,
        text=True,
    )
    if completed.returncode:
        raise AssertionError(
            f"cannot {'reverse ' if reverse else ''}apply {patch_path.name}: "
            f"{completed.stderr.strip()}"
        )
    if "Skipped patch" in completed.stderr:
        raise AssertionError(
            f"{patch_path.name} was silently skipped: {completed.stderr.strip()}"
        )


class FineSubPatchStackTests(unittest.TestCase):
    def test_stack_round_trips_between_pinned_baseline_and_vendor(self) -> None:
        upstream = json.loads(
            (DEFAULT_VENDOR / "UPSTREAM.json").read_text(encoding="utf-8")
        )
        patches = [PATCH_ROOT / item["path"] for item in upstream["patches"]]
        baseline = json.loads(BASELINE_MANIFEST.read_text(encoding="utf-8"))
        current = json.loads(
            (DEFAULT_VENDOR / "FILES.json").read_text(encoding="utf-8")
        )

        with tempfile.TemporaryDirectory(prefix="finoka-finesub-patches-") as temp:
            replay = Path(temp) / "vendor"
            shutil.copytree(DEFAULT_VENDOR, replay)

            for patch_path in reversed(patches):
                _git_apply(replay, patch_path, reverse=True)
            self.assertEqual(create_files_manifest(replay), baseline)

            for patch_path in patches:
                _git_apply(replay, patch_path)
            self.assertEqual(create_files_manifest(replay), current)


if __name__ == "__main__":
    unittest.main()
