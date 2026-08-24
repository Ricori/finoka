import assert from "node:assert/strict";
import test from "node:test";

import { buildAss, buildSrt } from "../src/editor/export.ts";

const document = {
  schema: 1,
  video_id: "loc_fixture",
  title: "fixture.mp4",
  source: "task",
  fp: "abc",
  rev: 1,
  subtitles: [
    { t0: 1.234, t1: 3.5, ja: "こんにちは", zh: "你好" },
    { t0: 4, t1: 5, ja: "二行目", zh: "第二行\n继续" },
  ],
  tracks: [],
  track_meta: { name: "主字幕", ja: { hidden: false, style: null }, zh: { hidden: false, style: null } },
  projection: { schema: 1, mode: "final" },
};

test("buildSrt emits deterministic bilingual cue timing", () => {
  const value = buildSrt(document, "both");
  assert.match(value, /00:00:01,234 --> 00:00:03,500/);
  assert.match(value, /こんにちは\n你好/);
  assert.match(value, /第二行\n继续/);
});

test("buildAss creates Japanese and Chinese styles and escapes line breaks", () => {
  const value = buildAss(document);
  assert.match(value, /Style: JP,/);
  assert.match(value, /Style: CN,/);
  assert.match(value, /Dialogue: 0,0:00:01\.23,0:00:03\.50,JP/);
  assert.match(value, /第二行\\N继续/);
});
