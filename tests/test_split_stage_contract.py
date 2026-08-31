"""What Finoka's FineSub engine patch is allowed to be.

The cloud runs one task across three containers and only the Whisper leg needs
the GPU, so ``patches/finesub/0001-split-vad-prefix-and-qwen-pass.patch`` makes
the VAD prefix and the Qwen pass separately runnable. Everything else about the
cloud is upstream code called with upstream arguments, and the value of that
claim is exactly the value of this file: it pins the seams the cloud depends on
*and* pins the patch to being additive, so nothing local can change underneath
a caller that never opts in.

That claim is about ``src/finesub`` -- the engine both sides import. A patch
confined to ``src/finesub_bootstrap`` fixes how *this machine* installs the
engine (the container installs nothing at run time), so it cannot make the two
sides compute anything different, and the stack is allowed to carry those.
"""

from __future__ import annotations

import ast
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "third_party" / "finesub"
PATCH_ROOT = ROOT / "patches" / "finesub"
STAGE_PATH = VENDOR / "src/finesub/speech/recognition/vad_asr_stage.py"
REFEREE_PATH = VENDOR / "src/finesub/speech/verification/qwen_referee.py"


def _module(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _top_level_names(module: ast.Module) -> set[str]:
    names = {
        node.name
        for node in module.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
    }
    for node in module.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            names.update(
                target.id for target in targets if isinstance(target, ast.Name)
            )
    return names


def _touched_paths(patch: Path) -> list[str]:
    """The vendor-relative files a patch writes to, sorted."""

    return sorted(
        line.split(" b/", 1)[1].strip()
        for line in patch.read_text(encoding="utf-8", errors="replace").splitlines()
        if line.startswith("diff --git ")
    )


#: Installer files that live outside the bootstrap package. The rule below is
#: about engine divergence, and `resources/runtime-manifest.json` is not engine
#: code: it is the catalog the installer downloads binaries from, its only
#: reader in the vendor tree is `src/finesub_bootstrap/shell.py`, and no
#: container ever runs it. Listed file by file rather than by directory so a
#: future `resources/` entry has to be classified on its own merits.
INSTALLER_PLUMBING_FILES = frozenset({"resources/runtime-manifest.json"})


def _is_installer_plumbing(path: str) -> bool:
    return path.startswith("src/finesub_bootstrap/") or path in INSTALLER_PLUMBING_FILES


#: Everything the split adds. A cloud container imports these by name, and the
#: patch's whole job is to put them there.
ADDED_NAMES = (
    "PREPARED_VAD_SCHEMA",
    "prepare_vad_asr",
    "prepared_vad_matches",
    "prepared_vad_has_speech",
    "finalize_qwen_verification",
)


class SplitSeamTests(unittest.TestCase):
    def test_the_stage_exposes_every_seam_the_cloud_calls(self) -> None:
        names = _top_level_names(_module(STAGE_PATH))
        for name in ADDED_NAMES:
            with self.subTest(name=name):
                self.assertTrue(
                    name in names,
                    f"{name} is missing; the cloud's CPU containers import it "
                    f"by name and would fail at the first task.",
                )

    def test_run_vad_asr_takes_a_prepared_artifact_and_defaults_to_none(self) -> None:
        """The one existing signature the patch touches.

        ``None`` is what makes the patch additive: every local run, the CLI and
        batch reach the untouched block that computes the prefix in-process.
        """

        functions = {
            node.name: node
            for node in _module(STAGE_PATH).body
            if isinstance(node, ast.FunctionDef)
        }
        arguments = functions["run_vad_asr"].args
        keyword_defaults = dict(zip(arguments.kwonlyargs, arguments.kw_defaults))
        parameter = next(
            arg for arg in arguments.kwonlyargs if arg.arg == "prepared_path"
        )
        self.assertIsInstance(keyword_defaults[parameter], ast.Constant)
        self.assertIsNone(keyword_defaults[parameter].value)

    def test_the_referee_exposes_the_warm_seam(self) -> None:
        """`warm` is why the scheduler can preload Qwen beside the GPU stage."""

        classes = {
            node.name: node
            for node in _module(REFEREE_PATH).body
            if isinstance(node, ast.ClassDef)
        }
        methods = {
            node.name
            for node in classes["QwenReferee"].body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        self.assertIn("warm", methods)


class PurelyAdditiveTests(unittest.TestCase):
    """The patch may add; it may not rewrite what local execution runs."""

    def test_engine_patches_are_explicit_and_the_rest_is_installer_plumbing(self) -> None:
        """Every engine patch is named here; all remaining patches are bootstrap-only.

        The cloud is meant to run upstream code. A patch under ``src/finesub``
        is a second thing local and cloud no longer share, so it has to be
        justified in ``docs/engine.md`` before it is added here. One
        under ``src/finesub_bootstrap`` is not: no container ever runs it, and
        neither is the installer's resource catalog (see
        ``INSTALLER_PLUMBING_FILES``).
        """

        upstream = json.loads((VENDOR / "UPSTREAM.json").read_text(encoding="utf-8"))
        names = [item["path"] for item in upstream["patches"]]
        self.assertEqual(names[0], "0001-split-vad-prefix-and-qwen-pass.patch")
        engine_patches = {
            "0003-desktop-model-routing.patch": [
                "src/finesub/llm/llm_runtime.py",
                "src/finesub/llm/routing/model_routes.py",
            ],
            "0004-subprocess-text-encoding-and-msvc-include.patch": [
                "src/finesub/media/ffmpeg.py",
                "src/finesub/media/source.py",
                "src/finesub/speech/preprocessing/separator/separator_aoti.py",
            ],
            # Data, not code: a catalog row and the two targets that make it
            # routable. The cloud runs the same declaration, so both sides
            # still resolve the same target ids.
            "0005-codex-terra-model.patch": [
                "src/finesub/llm/routing/model_catalog.psv",
                "src/finesub/llm/routing/model_routes.toml",
            ],
            # Local-only ground: the driver that launches a CLI on the
            # user's machine. No container ever spawns one, so the two
            # sides still run the same code on every path the cloud takes.
            "0007-agy-workspace-read-grant.patch": [
                "src/finesub/llm/agent/local_agent.py",
            ],
        }
        for name in names[1:]:
            with self.subTest(patch=name):
                outside = [
                    path
                    for path in _touched_paths(PATCH_ROOT / name)
                    if not _is_installer_plumbing(path)
                ]
                if name in engine_patches:
                    self.assertEqual(outside, engine_patches[name])
                else:
                    self.assertEqual(outside, [])

    def test_the_patch_touches_only_the_two_files_the_split_needs(self) -> None:
        self.assertEqual(
            _touched_paths(PATCH_ROOT / "0001-split-vad-prefix-and-qwen-pass.patch"),
            [
                "src/finesub/speech/recognition/vad_asr_stage.py",
                "src/finesub/speech/verification/qwen_referee.py",
            ],
        )

    def test_the_patch_removes_no_statement_it_does_not_re_indent(self) -> None:
        """Every deleted line of code must reappear, verbatim modulo indent.

        The prefix block moves into an ``else:`` arm, so its lines are removed
        and re-added one level deeper -- that is the only rewriting allowed. A
        removed statement with no re-indented twin would mean the patch changed
        what upstream computes, which is the thing this whole arrangement
        exists to avoid.
        """

        removed, added = self._patch_lines()
        orphans = [
            line
            for line in removed
            if line and not line.startswith("#") and line not in set(added)
        ]
        self.assertEqual(orphans, [])

    def test_the_patch_rewords_no_comment_it_only_re_wraps(self) -> None:
        """Comments may be re-wrapped by the deeper indent, not rewritten.

        Four extra columns push two of upstream's comment lines past the line
        length, so they come back split differently. Checked as text with the
        wrapping collapsed: the words have to be upstream's, in upstream's
        order, or the patch is editing prose it has no business editing.
        """

        removed, added = self._patch_lines()
        added_text = " ".join(
            line.lstrip("#").strip() for line in added if line.startswith("#")
        )
        for block in self._comment_blocks(removed):
            with self.subTest(comment=block[:40]):
                self.assertIn(block, added_text)

    @staticmethod
    def _patch_lines() -> tuple[list[str], list[str]]:
        patch = (PATCH_ROOT / "0001-split-vad-prefix-and-qwen-pass.patch").read_text(
            encoding="utf-8", errors="replace"
        )
        removed = [
            line[1:].strip()
            for line in patch.splitlines()
            if line.startswith("-") and not line.startswith("---")
        ]
        added = [
            line[1:].strip()
            for line in patch.splitlines()
            if line.startswith("+") and not line.startswith("+++")
        ]
        return removed, added

    @staticmethod
    def _comment_blocks(lines: list[str]) -> list[str]:
        """Runs of consecutive comment lines, joined into one string each."""

        blocks: list[list[str]] = [[]]
        for line in lines:
            if line.startswith("#"):
                blocks[-1].append(line.lstrip("#").strip())
            elif blocks[-1]:
                blocks.append([])
        return [" ".join(block) for block in blocks if block]

    def test_no_execution_profile_switch_survives_in_the_engine(self) -> None:
        """The retired mechanism, kept retired.

        `finesub.execution` gated cloud-only behaviour inside shared code. Every
        such gate is gone; the cloud now differs from local by which functions
        it calls, which is visible at the call site instead of buried in a
        context variable.
        """

        self.assertFalse((VENDOR / "src/finesub/execution.py").exists())
        self.assertFalse((VENDOR / "src/finesub/execution_policy.py").exists())
        offenders = [
            path.relative_to(VENDOR).as_posix()
            for path in (VENDOR / "src").rglob("*.py")
            if "cloud_execution_enabled" in path.read_text(encoding="utf-8")
        ]
        self.assertEqual(offenders, [])


class AddedCodeTests(unittest.TestCase):
    def test_added_functions_are_documented_where_they_are_defined(self) -> None:
        """A patched-in seam with no docstring is one upstream cannot review."""

        module = _module(STAGE_PATH)
        public = {
            node.name: node
            for node in module.body
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_")
        }
        for name in ADDED_NAMES:
            if name not in public:
                continue
            with self.subTest(name=name):
                self.assertTrue(ast.get_docstring(public[name]))


if __name__ == "__main__":
    unittest.main()
