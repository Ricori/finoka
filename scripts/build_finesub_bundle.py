#!/usr/bin/env python3
"""Build a byte-stable FineSub engine bundle from the verified snapshot."""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

from scripts.sync_finesub import (
    DEFAULT_VENDOR,
    SyncError,
    canonical_json,
    iter_snapshot_files,
    sha256_file,
    verify_snapshot,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = REPO_ROOT / "dist"
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def archive_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def build_bundle(vendor: Path = DEFAULT_VENDOR, output_dir: Path = DEFAULT_OUTPUT) -> Path:
    upstream = verify_snapshot(vendor)
    bundle_id = upstream["engine_bundle_id"]
    output_dir.mkdir(parents=True, exist_ok=True)
    destination = output_dir / f"{bundle_id}.zip"
    bundle_manifest = {
        "schema": 1,
        "bundle_id": bundle_id,
        "engine": {
            "name": "finesub",
            "version": upstream["engine_version"],
            "commit": upstream["commit"],
        },
        "adapter_schema": 1,
        "artifact_schema": 1,
        "content_sha256": upstream["content_sha256"],
        "runtime_manifest_sha256": upstream["runtime_manifest_sha256"],
    }
    fd, temporary_name = tempfile.mkstemp(prefix=f".{bundle_id}-", suffix=".zip", dir=output_dir)
    os.close(fd)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            prefix = f"finesub-engine/{bundle_id}"
            snapshot_files = [*iter_snapshot_files(vendor), vendor / "FILES.json", vendor / "UPSTREAM.json"]
            for path in sorted(snapshot_files):
                relative = path.relative_to(vendor).as_posix()
                bundle.writestr(archive_info(f"{prefix}/{relative}"), path.read_bytes())
            bundle.writestr(archive_info(f"{prefix}/engine-bundle.json"), canonical_json(bundle_manifest))
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vendor-dir", type=Path, default=DEFAULT_VENDOR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args(argv)
    try:
        result = build_bundle(args.vendor_dir, args.output_dir)
    except (SyncError, OSError, KeyError, json.JSONDecodeError) as exc:
        print(f"build-finesub-bundle: {exc}", file=sys.stderr)
        return 1
    print(f"{result}  sha256={sha256_file(result)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
