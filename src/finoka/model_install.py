"""Install one pinned FineSub model inside the managed runtime."""

from __future__ import annotations

import argparse
from pathlib import Path


def install_model(model_id: str, models_root: Path, data_root: Path) -> None:
    from finesub_bootstrap.download_routes import resolve_region
    from finesub_bootstrap.model_manifest import entry_for, file_matches

    entry = entry_for(model_id)
    if entry is None:
        raise RuntimeError(f"FineSub model manifest has no {model_id!r} entry")
    if model_id == "separator":
        from finesub_bootstrap.model_fetch import fetch_fixed_files

        fetch_fixed_files(
            entry,
            models_root / "audio-separator",
            data_root=data_root,
            region=resolve_region(data_root).region,
        )
        return

    if not entry.repo or not entry.revision:
        raise RuntimeError(f"FineSub model {model_id!r} has no pinned repository")
    from huggingface_hub import snapshot_download

    snapshot = Path(
        snapshot_download(
            repo_id=entry.repo,
            revision=entry.revision,
            cache_dir=models_root / "huggingface" / "hub",
        )
    )
    mismatches = [wanted.name for wanted in entry.files if wanted.is_verifiable and not file_matches(snapshot / wanted.name, wanted)]
    if mismatches:
        raise RuntimeError(f"FineSub model {model_id!r} failed manifest verification: {', '.join(mismatches)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True, choices=("separator", "whisper", "qwen-referee"))
    parser.add_argument("--models-root", required=True, type=Path)
    parser.add_argument("--data-root", required=True, type=Path)
    args = parser.parse_args(argv)
    install_model(args.model, args.models_root.expanduser().resolve(), args.data_root.expanduser().resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
