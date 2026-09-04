"""What reaches the harness when a CLI escapes the tool arguments it forwards.

antigravity-cli 1.1.24 cannot put a non-ASCII character into a `tools/call`
argument: it spells every one of them as a literal six-character escape inside
the JSON string, so the harness MCP server decodes the frame and holds the
escape text rather than the text. Nothing downstream of `submit` can tell the
two apart -- the run measured on 2026-09-04 validated, wrote and delivered a
whole window of subtitles as escapes, and reported success -- so patch 0009
repairs the arguments at the frame boundary.

This pins both halves of that repair: the mangled argument is decoded, and an
argument no CLI mangled is handed on untouched.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "third_party/finesub/src"))

from finesub.llm.agent.agent_mcp_server import (  # noqa: E402
    HarnessToolServer,
    _unescaped_arguments,
    _unescaped_tool_text,
)


BACKSLASH = "\\"


def _escaped(text: str) -> str:
    """``text`` as the CLI hands it over: every non-ASCII character escaped."""

    escaped = []
    for character in text:
        if character.isascii():
            escaped.append(character)
            continue
        # UTF-16 code units, so a character outside the BMP is two escapes.
        units = character.encode("utf-16-be")
        escaped.extend(
            BACKSLASH + "u%02x%02x" % (units[index], units[index + 1])
            for index in range(0, len(units), 2)
        )
    return "".join(escaped)


class ToolArgumentEncodingTests(unittest.TestCase):
    def test_escaped_argument_is_decoded(self) -> None:
        answer = "sub|1|伝える言葉は|想说的话早已想好|high|10|"
        self.assertEqual(_unescaped_tool_text(_escaped(answer)), answer)

    def test_intact_argument_is_left_alone(self) -> None:
        for argument in (
            "sub|1|伝える言葉は|想说的话早已想好|high|10|",  # a driver that behaves
            "plain ascii payload",
            "a " + BACKSLASH + "u0041 b",  # decodes to ASCII: the model meant it
            BACKSLASH + "ud83d alone",  # a lone surrogate decodes to nothing safe
            "C:" + BACKSLASH + "users",  # a backslash that is not an escape
        ):
            self.assertEqual(_unescaped_tool_text(argument), argument)

    def test_astral_characters_arrive_as_a_surrogate_pair(self) -> None:
        self.assertEqual(_unescaped_tool_text(_escaped("🌞")), "🌞")

    def test_every_string_in_the_arguments_is_repaired(self) -> None:
        arguments = {
            "payload": _escaped("纠错终稿"),
            "offset": 0,
            "queries": [_escaped("夏影 主题曲"), "ascii"],
        }
        self.assertEqual(
            _unescaped_arguments(arguments),
            {"payload": "纠错终稿", "offset": 0, "queries": ["夏影 主题曲", "ascii"]},
        )

    def test_the_repair_happens_before_the_call_is_dispatched(self) -> None:
        # The fingerprint, the dedup and every handler have to see the argument
        # the model wrote, so the repair belongs to `handle`, not to `submit`.
        seen: dict[str, object] = {}

        class RecordingServer(HarnessToolServer):
            def __init__(self) -> None:  # the runtime is never reached
                pass

            def _call(self, name, arguments, *, rpc_id):  # type: ignore[override]
                seen["name"] = name
                seen["arguments"] = dict(arguments)
                return {"status": "accepted"}

        RecordingServer().handle(
            {
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {"name": "submit", "arguments": {"payload": _escaped("终稿")}},
            }
        )
        self.assertEqual(seen, {"name": "submit", "arguments": {"payload": "终稿"}})


if __name__ == "__main__":
    unittest.main()
