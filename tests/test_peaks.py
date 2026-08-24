from __future__ import annotations

import struct
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from finoka.peaks import bucket_peak


class PeakTests(unittest.TestCase):
    def test_bucket_peak_is_normalized_and_uses_absolute_amplitude(self) -> None:
        raw = struct.pack("<hhh", -16384, 8192, 32767)
        self.assertEqual(bucket_peak(raw), 1.0)
        self.assertEqual(bucket_peak(struct.pack("<h", -8192)), 0.25)
        self.assertEqual(bucket_peak(b""), 0.0)


if __name__ == "__main__":
    unittest.main()
