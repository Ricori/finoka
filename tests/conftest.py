"""Shared test import paths for the vendored FineSub runtime."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDOR_SOURCE = ROOT / "third_party" / "finesub" / "src"

if str(VENDOR_SOURCE) not in sys.path:
    sys.path.insert(0, str(VENDOR_SOURCE))
