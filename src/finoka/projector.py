"""Project FineSub artifacts into the editor's stable EditDocument schema."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping


class ProjectionError(ValueError):
    """FineSub artifacts cannot be mapped without guessing or data loss."""


@dataclass(frozen=True)
class SrtCue:
    start: float
    end: float
    text: str


_TIMING = re.compile(
    r"(?P<start>\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2},\d{3})"
)


def _srt_seconds(value: str) -> float:
    hours, minutes, tail = value.split(":")
    seconds, millis = tail.split(",")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds) + int(millis) / 1000


def parse_srt(text: str) -> list[SrtCue]:
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").splitlines()
    cues: list[SrtCue] = []
    index = 0
    while index < len(lines):
        while index < len(lines) and not lines[index].strip():
            index += 1
        if index >= len(lines):
            break
        if lines[index].strip().isdigit():
            index += 1
        if index >= len(lines):
            raise ProjectionError("final SRT ends before a timing line")
        match = _TIMING.fullmatch(lines[index].strip())
        if not match:
            raise ProjectionError(f"invalid final SRT timing line: {lines[index]!r}")
        index += 1
        body: list[str] = []
        while index < len(lines) and lines[index].strip():
            body.append(lines[index])
            index += 1
        if not body:
            raise ProjectionError("final SRT cue has no text")
        start = _srt_seconds(match.group("start"))
        end = _srt_seconds(match.group("end"))
        if end <= start:
            raise ProjectionError("final SRT cue has a non-positive duration")
        cues.append(SrtCue(start, end, "\n".join(body).strip()))
    return cues


def _decode_cell(value: str) -> str:
    decoded = (value or "").strip().replace(r"\n", "\n")
    return re.sub(r"\n{2,}", "\n", decoded)


def _confidence(value: str) -> str | None:
    normalized = (value or "").strip().lower()
    if normalized in {"high", "median", "low"}:
        return normalized
    try:
        legacy = int(normalized)
    except ValueError:
        return None
    if not 1 <= legacy <= 9:
        return None
    return "high" if legacy >= 7 else "median" if legacy >= 4 else "low"


def parse_annotated(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line_number, raw_line in enumerate((text or "").splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split("|", 8)
        if len(fields) != 9:
            raise ProjectionError(f"annotated.csv line {line_number} does not have 9 columns")
        kind, position, duration, _gap, corrected, translation, conf, _chars, _note = fields
        try:
            float(duration)
        except ValueError as exc:
            raise ProjectionError(
                f"annotated.csv line {line_number} has no numeric duration; regenerate it with this engine"
            ) from exc
        normalized_kind = kind.strip().lower() or "sub"
        source_ids = [] if normalized_kind == "insert" else [
            item.strip() for item in position.split(",") if item.strip()
        ]
        if normalized_kind != "insert" and not source_ids:
            raise ProjectionError(f"annotated.csv line {line_number} has no source ids")
        rows.append(
            {
                "kind": "insert" if normalized_kind == "insert" else "sub",
                "source_ids": source_ids,
                "corrected": _decode_cell(corrected),
                "translation": _decode_cell(translation),
                "conf": _confidence(conf),
            }
        )
    return rows


def _load_stable(path: Path) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProjectionError(f"cannot read stable JSON: {exc}") from exc
    segments = payload.get("segments") if isinstance(payload, dict) else payload
    if not isinstance(segments, list) or not segments:
        raise ProjectionError("stable JSON must contain a non-empty segments list")
    normalized: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for index, value in enumerate(segments, start=1):
        if not isinstance(value, dict):
            raise ProjectionError(f"stable segment {index} is not an object")
        source_id = str(value.get("id", index))
        if source_id in by_id:
            raise ProjectionError(f"stable JSON has duplicate source id {source_id!r}")
        try:
            start, end = float(value["start"]), float(value["end"])
        except (KeyError, TypeError, ValueError) as exc:
            raise ProjectionError(f"stable segment {source_id!r} has invalid timing") from exc
        if end <= start:
            raise ProjectionError(f"stable segment {source_id!r} has a non-positive duration")
        words = value.get("words")
        segment = {
            "id": source_id,
            "start": start,
            "end": end,
            "text": str(value.get("text") or "").strip(),
            "words": list(words) if isinstance(words, list) else [],
            "low_conf": bool(
                value.get("low_conf")
                or value.get("low_confidence")
                or str(value.get("confidence_label") or "").lower() == "low"
            ),
        }
        normalized.append(segment)
        by_id[source_id] = segment
    return normalized, by_id


def _words_for(source_ids: Iterable[str], stable: Mapping[str, dict[str, Any]]) -> list[Any]:
    words: list[Any] = []
    for source_id in source_ids:
        if source_id not in stable:
            raise ProjectionError(f"annotated.csv references unknown stable source id {source_id!r}")
        words.extend(stable[source_id]["words"])
    return words


def project_edit_document(
    stable_json: str | Path,
    *,
    annotated_csv: str | Path | None = None,
    final_srt: str | Path | None = None,
    video_id: str,
    title: str,
    source: str = "",
    fingerprint: str | None = None,
) -> dict[str, Any]:
    """Create an editor-compatible document from raw or final FineSub artifacts."""

    stable_segments, stable_by_id = _load_stable(Path(stable_json))
    if (annotated_csv is None) != (final_srt is None):
        raise ProjectionError("annotated_csv and final_srt must be supplied together")
    projected: list[dict[str, Any]] = []
    mode = "stable"
    if annotated_csv is None:
        for segment in stable_segments:
            item = {
                "t0": segment["start"],
                "t1": segment["end"],
                "ja": segment["text"],
                "zh": "",
            }
            if segment["words"]:
                item["words"] = segment["words"]
            if segment["low_conf"]:
                item["low_conf"] = True
            projected.append(item)
    else:
        annotated = parse_annotated(Path(annotated_csv).read_text(encoding="utf-8"))
        cues = parse_srt(Path(final_srt).read_text(encoding="utf-8"))
        if len(annotated) != len(cues):
            raise ProjectionError(
                "annotated.csv and final SRT row counts differ "
                f"({len(annotated)} vs {len(cues)}); refusing positional truncation"
            )
        mode = "final"
        for row, cue in zip(annotated, cues, strict=True):
            words = _words_for(row["source_ids"], stable_by_id)
            item = {
                "t0": cue.start,
                "t1": cue.end,
                "ja": row["corrected"],
                "zh": cue.text,
            }
            if words:
                item["words"] = words
            source_low = any(stable_by_id[source_id]["low_conf"] for source_id in row["source_ids"])
            if row["conf"] == "low" or source_low:
                item["low_conf"] = True
            projected.append(item)
    return {
        "schema": 1,
        "video_id": video_id,
        "title": title,
        "source": source,
        "fp": fingerprint,
        "rev": 0,
        "subtitles": projected,
        "tracks": [],
        "track_meta": {
            "name": "默认轨",
            "ja": {"hidden": False, "style": "JP"},
            "zh": {"hidden": False, "style": "CN"},
        },
        "projection": {"schema": 1, "mode": mode},
    }

