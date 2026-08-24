from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from finoka.document_store import DocumentError, DocumentStore, RevisionConflict
from finoka.projector import ProjectionError, project_edit_document


FIXTURES = Path(__file__).parent / "fixtures" / "finesub"


class ProjectorTests(unittest.TestCase):
    def test_stable_only_projection_preserves_words(self) -> None:
        document = project_edit_document(
            FIXTURES / "sample-stable.json", video_id="video-1", title="Sample"
        )
        self.assertEqual(document["projection"]["mode"], "stable")
        self.assertEqual(document["subtitles"][0]["ja"], "おはよう")
        self.assertEqual(document["subtitles"][0]["zh"], "")
        self.assertEqual(document["subtitles"][0]["words"][0]["word"], "おはよう")
        self.assertTrue(document["subtitles"][2]["low_conf"])

    def test_final_projection_merges_source_words_and_uses_final_timeline(self) -> None:
        document = project_edit_document(
            FIXTURES / "sample-stable.json",
            annotated_csv=FIXTURES / "sample-annotated.csv",
            final_srt=FIXTURES / "sample-final.srt",
            video_id="video-1",
            title="Sample",
        )
        first = document["subtitles"][0]
        self.assertEqual((first["t0"], first["t1"]), (1.0, 3.0))
        self.assertEqual(first["ja"], "おはようございます")
        self.assertEqual(first["zh"], "早上好")
        self.assertEqual([word["word"] for word in first["words"]], ["おはよう", "ございます"])
        self.assertTrue(document["subtitles"][1]["low_conf"])

    def test_row_count_mismatch_fails_instead_of_zipping(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            one_cue = Path(temp) / "one.srt"
            one_cue.write_text(
                "1\n00:00:01,000 --> 00:00:02,000\n一\n", encoding="utf-8"
            )
            with self.assertRaisesRegex(ProjectionError, "row counts differ"):
                project_edit_document(
                    FIXTURES / "sample-stable.json",
                    annotated_csv=FIXTURES / "sample-annotated.csv",
                    final_srt=one_cue,
                    video_id="video-1",
                    title="Sample",
                )


class DocumentStoreTests(unittest.TestCase):
    def projection(self) -> dict:
        return project_edit_document(
            FIXTURES / "sample-stable.json", video_id="video-1", title="Sample"
        )

    def test_save_uses_revision_and_writes_history(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = DocumentStore(temp)
            created = store.create("video-1", self.projection(), artifacts={"schema": 1})
            saved = store.save(
                "video-1", expected_rev=created["rev"], subtitles=created["subtitles"]
            )
            self.assertEqual(saved["rev"], 1)
            self.assertTrue((Path(temp) / "video-1/history/00000000.json").is_file())
            self.assertTrue((Path(temp) / "video-1/original.json").is_file())
            with self.assertRaises(RevisionConflict):
                store.save("video-1", expected_rev=0, subtitles=[])

    def test_reprojection_preserves_manual_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            store = DocumentStore(temp)
            created = store.create("video-1", self.projection())
            track = {"id": "manual", "name": "Speaker", "segs": [{"t0": 1, "t1": 2, "ja": "x", "zh": ""}]}
            store.save(
                "video-1",
                expected_rev=created["rev"],
                subtitles=created["subtitles"],
                tracks=[track],
            )
            replaced = store.create("video-1", self.projection(), replace_default=True)
            self.assertEqual(replaced["tracks"], [track])
            self.assertEqual(replaced["rev"], 2)


if __name__ == "__main__":
    unittest.main()
