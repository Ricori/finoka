"""What Nonoka X's FineSub engine patches are allowed to be.

The cloud runs one task across three containers and only the Whisper leg needs
the GPU. Upstream 0.5.0 split the VAD half out by itself -- `run_vad_prefix`,
`write_vad_prefix`/`read_vad_prefix`, `run_vad_asr(vad_prefix_path=...)`, and
the referee's `warm` seam -- so the CPU container that used to need a patch now
calls upstream code with upstream arguments. What is still ours is the other
end: ``patches/finesub/0001-qwen-tail-entry-point.patch`` adds
`finalize_qwen_verification`, which attaches the referee's evidence to an
aligned artifact the GPU container already wrote.

Everything else about the cloud is upstream code called with upstream
arguments, and the value of that claim is exactly the value of this file: it
pins the seams the cloud depends on -- upstream's and ours alike, because a
sync can take either away -- *and* pins our patch to being additive, so nothing
local can change underneath a caller that never opts in.

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
TAIL_PATCH = "0001-qwen-tail-entry-point.patch"


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


def _is_installer_plumbing(path: str) -> bool:
    """Whether a patched file only affects how this machine installs.

    One prefix, and the runtime manifest is inside it since upstream 0.5.0 made
    it package data: the catalog the installer downloads binaries from now
    lives at ``src/finesub_bootstrap/runtime-manifest.json``, read there by
    `finesub_bootstrap.resources`, and no container ever runs it.
    """

    return path.startswith("src/finesub_bootstrap/")


#: What the tail patch adds. A cloud container imports it by name, and the
#: patch's whole job is to put it there.
ADDED_NAMES = ("finalize_qwen_verification",)

#: Upstream's own split seams, which the cloud's CPU container calls instead of
#: the ones our patch used to add. Listed here because a sync can retire them
#: as easily as it introduced them, and the failure would otherwise be a
#: traceback on the first cloud task rather than a red test.
UPSTREAM_NAMES = (
    "VadPrefix",
    "run_vad_prefix",
    "write_vad_prefix",
    "read_vad_prefix",
    "default_vad_prefix_path",
)


class SplitSeamTests(unittest.TestCase):
    def test_the_stage_exposes_every_seam_the_cloud_calls(self) -> None:
        names = _top_level_names(_module(STAGE_PATH))
        for name in (*UPSTREAM_NAMES, *ADDED_NAMES):
            with self.subTest(name=name):
                self.assertTrue(
                    name in names,
                    f"{name} is missing; the cloud's CPU containers import it "
                    f"by name and would fail at the first task.",
                )

    def test_run_vad_asr_takes_a_stored_prefix_and_defaults_to_none(self) -> None:
        """Upstream's own opt-in, and the reason our half stays small.

        ``None`` is what keeps every local run, the CLI and batch on the
        in-process prefix; the cloud passes the path the CPU container wrote.
        """

        functions = {
            node.name: node
            for node in _module(STAGE_PATH).body
            if isinstance(node, ast.FunctionDef)
        }
        arguments = functions["run_vad_asr"].args
        keyword_defaults = dict(zip(arguments.kwonlyargs, arguments.kw_defaults))
        parameter = next(
            arg for arg in arguments.kwonlyargs if arg.arg == "vad_prefix_path"
        )
        self.assertIsInstance(keyword_defaults[parameter], ast.Constant)
        self.assertIsNone(keyword_defaults[parameter].value)

    def test_the_referee_exposes_the_warm_seam(self) -> None:
        """`warm` is why the scheduler can preload Qwen beside the GPU stage.

        Upstream's since 0.5.0, pinned here for the same reason as
        `UPSTREAM_NAMES`: the cloud calls it by name.
        """

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
    """The stack may add; it may not rewrite what local execution runs."""

    def test_engine_patches_are_explicit_and_the_rest_is_installer_plumbing(self) -> None:
        """Every engine patch is named here; all remaining patches are bootstrap-only.

        The cloud is meant to run upstream code. A patch under ``src/finesub``
        is a second thing local and cloud no longer share, so it has to be
        justified in ``docs/engine.md`` before it is added here. One under
        ``src/finesub_bootstrap`` is not: no container ever runs it.
        """

        upstream = json.loads((VENDOR / "UPSTREAM.json").read_text(encoding="utf-8"))
        names = [item["path"] for item in upstream["patches"]]
        self.assertEqual(names[0], TAIL_PATCH)
        engine_patches = {
            TAIL_PATCH: [
                "src/finesub/speech/recognition/vad_asr_stage.py",
            ],
            # Local-only ground: the driver that launches a CLI on the
            # user's machine. No container ever spawns one, so the two
            # sides still run the same code on every path the cloud takes.
            "0003-agy-workspace-read-grant.patch": [
                "src/finesub/llm/agent/local_agent.py",
            ],
            # Reachability, not transcription. Loading pinned local weights
            # offline and treating a failed evidence pass as missing evidence
            # change what a run survives, never what it decides: the referee's
            # output is read the same way when it exists, and the containment
            # arm only fires where an exception would have ended the run. The
            # cloud runs this too and wants it -- a container that cannot
            # reach the hub loses the same alignment pass for the same reason.
            "0004-qwen-referee-offline-and-nonfatal.patch": [
                "src/finesub/llm/media_upload.py",
                "src/finesub/speech/recognition/vad_asr_stage.py",
                "src/finesub/speech/verification/qwen_referee.py",
            ],
            # Toolchain compatibility on Windows MSVC with C11: Triton's
            # launcher generator uses empty struct initializers `{}`.
            "0006-triton-msvc-c11-empty-struct.patch": [
                "src/finesub/speech/preprocessing/separator/separator_aoti.py",
            ],
            # Survivability and visibility, not transcription. The referee's
            # device was already a per-machine answer (the tier picks it, and
            # the entry tier has always kept it on the CPU); this only stops
            # that answer from being made against a budget the card does not
            # actually have, which is the difference between a decode that
            # finishes and a worker that dies mid-group with no exception. The
            # progress half adds events and reads nothing. The cloud runs both
            # and wants both -- a container sharing its card loses the same
            # alignment pass the same way.
            # Transport repair, not transcription. The harness MCP server
            # is how a local CLI hands an answer back, and one CLI escapes
            # the non-ASCII characters of its tool arguments; decoding them
            # gives the pipeline the text the model wrote instead of the
            # escapes. No container spawns a CLI, so the cloud never reaches
            # this code at all.
            "0009-agent-tool-arg-unicode-escapes.patch": [
                "src/finesub/llm/agent/agent_mcp_server.py",
            ],
            "0007-referee-live-vram-and-verify-progress.patch": [
                "src/finesub/speech/recognition/lang_redecode.py",
                "src/finesub/speech/recognition/vad_asr_stage.py",
                "src/finesub/speech/verification/qwen_referee.py",
            ],
        }
        for name in names:
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

    def test_the_tail_patch_touches_one_file(self) -> None:
        self.assertEqual(
            _touched_paths(PATCH_ROOT / TAIL_PATCH),
            ["src/finesub/speech/recognition/vad_asr_stage.py"],
        )

    def test_the_tail_patch_removes_nothing_at_all(self) -> None:
        """Additive with no exceptions, which upstream 0.5.0 made possible.

        The old split patch had to move upstream's prefix block into an
        ``else:`` arm, so it removed and re-added real statements and this test
        had to reason about re-indentation. Upstream owns the prefix now, and
        what is left adds one function: a single removed line would mean the
        patch had started editing what local execution runs.
        """

        patch = (PATCH_ROOT / TAIL_PATCH).read_text(encoding="utf-8", errors="replace")
        removed = [
            line
            for line in patch.splitlines()
            if line.startswith("-") and not line.startswith("---")
        ]
        self.assertEqual(removed, [])

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
