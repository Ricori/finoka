"""Isolated FineSub worker. Stdin is one TaskRequest; stdout is NDJSON events."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Mapping


def emit(event_type: str, payload: Mapping[str, Any] | None = None) -> None:
    print(json.dumps({"type": event_type, "payload": dict(payload or {})}, ensure_ascii=False, separators=(",", ":")), flush=True)


class FinokaReporter:
    def planned(self, stages) -> None:
        return

    def stage_started(self, stage: str, *, reused: bool = False, detail: str = "") -> None:
        emit("stage", {"stage": stage, "message": "已有结果，跳过" if reused else (detail or "正在处理"), "reused": reused})

    def progress(self, stage: str, *, completed: int, total: int | None = None, unit: str = "", detail: str = "") -> None:
        emit("progress", {"stage": stage, "completed": completed, "total": total, "unit": unit, "message": detail})

    def summary(self, stage: str, metrics) -> None:
        emit("log", {"message": f"{stage}: " + "，".join(f"{key} {value}" for key, value in metrics.items())})

    def warning(self, code: str, message: str, *, impact: str = "", action: str = "") -> None:
        emit("warning", {"code": code, "message": message, "impact": impact, "action": action})

    def debug(self, message: str, fields=None) -> None:
        emit("log", {"message": message, "fields": dict(fields or {})})

    def completed(self, output, elapsed_sec: float) -> None:
        return

    def failed(self, stage: str, message: str) -> None:
        emit("failed", {"stage": stage, "message": message})


def artifact(path: Path) -> dict[str, Any]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return {"uri": path.resolve().as_uri(), "sha256": digest, "bytes": path.stat().st_size}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--task-dir", type=Path, required=True)
    parser.add_argument("--vendor", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        request = json.loads(sys.stdin.readline())
        source = request["source"]
        correction = request.get("correction") or {}
        title = str(source.get("title") or Path(source["path"]).stem)
        output = args.task_dir / "workspace" / f"{title}.srt"
        output.parent.mkdir(parents=True, exist_ok=True)
        from finesub.pipeline import run_pipeline
        from finesub.reporting import quieted_libraries, reporting_to

        with reporting_to(FinokaReporter()), quieted_libraries("normal"):
            paths = run_pipeline(
                source["path"],
                output_path=output,
                stage=request["target"],
                language=request.get("language", "ja"),
                device=request.get("device", "cuda"),
                gpu_budget_gb=int(request.get("gpu_budget_gb", 8)),
                execution_profile="local",
                vocal_profile=request.get("vocal_profile", "quality"),
                llm_media=correction.get("media", "audio"),
                llm_retrieval=correction.get("retrieval", "local"),
                llm_difficulty=correction.get("difficulty", "quality"),
                llm_fast=correction.get("fast", "auto"),
                extra_info=correction.get("extra_info", ""),
                extra_style=correction.get("extra_style", ""),
                knowledge=request.get("knowledge", "update"),
                task_id=args.task_id,
                task_artifact_dir=args.task_dir / "workspace" / "llm-artifacts",
                resume=True,
            )
        candidates = {
            "stable_json": Path(paths.stable_json),
            "raw_srt": Path(paths.raw_srt),
            "annotated_csv": Path(paths.final_srt).with_name(f"{Path(paths.final_srt).stem}-annotated.csv"),
            "final_srt": Path(paths.final_srt),
        }
        upstream = json.loads((args.vendor / "UPSTREAM.json").read_text(encoding="utf-8"))
        manifest = {
            "schema": 1,
            "task_id": args.task_id,
            "engine_commit": upstream["commit"],
            "artifacts": {name: artifact(path) for name, path in candidates.items() if path.is_file()},
        }
        emit("completed", {"artifacts": manifest})
        return 0
    except Exception as exc:
        emit("failed", {"message": f"{type(exc).__name__}: {exc}"})
        traceback.print_exc(file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
