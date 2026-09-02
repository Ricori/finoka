import assert from "node:assert/strict";
import test from "node:test";

import { parseAxisFile, recolumn } from "../src/subtitles/assAxis.ts";

// 判型错一次的代价是白跑一遍识别（或者相反：把日文轴当空轴丢掉原文），所以这里盯的
// 是四种产物各自的判据，以及那条把「打轴批注」和「中文轴」分开的重复度规则。

const ass = (events, format = "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text") =>
  `[Script Info]\nScriptType: v4.00+\n\n[Events]\n${format}\n${events.join("\n")}\n`;

const dialogue = (start, end, style, text) => `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}`;

test("SRT with timings only is an empty axis", () => {
  const parsed = parseAxisFile("1\n00:00:01,000 --> 00:00:02,500\n\n2\n00:00:03,000 --> 00:00:04,000\n", "轴.srt");
  assert.equal(parsed.kind, "empty");
  assert.deepEqual(parsed.rows.map((row) => [row.t0, row.t1]), [[1, 2.5], [3, 4]]);
});

test("SRT with a translation line under each source line is bilingual", () => {
  const parsed = parseAxisFile(
    "1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n你好\n\n2\n00:00:03,000 --> 00:00:04,000\nまたね\n回见\n",
    "双语.srt",
  );
  assert.equal(parsed.kind, "bi");
  assert.deepEqual(parsed.rows.map((row) => [row.ja, row.zh]), [["こんにちは", "你好"], ["またね", "回见"]]);
});

test("a source-only file is a Japanese axis", () => {
  const parsed = parseAxisFile(ass([
    dialogue("0:00:01.00", "0:00:02.00", "Default", "おはようございます"),
    dialogue("0:00:03.00", "0:00:04.00", "Default", "そうですね"),
  ]), "日文.ass");
  assert.equal(parsed.kind, "ja");
  assert.deepEqual(parsed.rows.map((row) => row.ja), ["おはようございます", "そうですね"]);
  assert.deepEqual(parsed.rows.map((row) => row.zh), ["", ""]);
});

test("repeated Chinese timing notes are an empty axis, not a translation", () => {
  // 真实空轴里打轴人留下的批注：翻来覆去就那几句，唯一率远低于真正的字幕。
  const notes = ["前压可以再紧紧", "前压可以再紧紧", "轴过头了", "前压可以再紧紧", "轴过头了"];
  const parsed = parseAxisFile(ass(notes.map((note, index) =>
    dialogue(`0:00:0${index}.00`, `0:00:0${index + 1}.00`, "Default", note))), "空轴.ass");
  assert.equal(parsed.kind, "empty");
  assert.deepEqual(parsed.rows.map((row) => row.zh), ["", "", "", "", ""]);
  assert.equal(parsed.rows.length, 5);
});

test("distinct Chinese lines are a translated axis", () => {
  const lines = ["第一句", "第二句", "第三句", "第四句", "第五句"];
  const parsed = parseAxisFile(ass(lines.map((line, index) =>
    dialogue(`0:00:0${index}.00`, `0:00:0${index + 1}.00`, "Default", line))), "中文.ass");
  assert.equal(parsed.kind, "zh");
  assert.deepEqual(parsed.rows.map((row) => row.zh), lines);
});

test("one style per person is read as the cast, by airtime", () => {
  const parsed = parseAxisFile(ass([
    dialogue("0:00:00.00", "0:00:04.00", "优花", "ながいセリフ"),
    dialogue("0:00:04.00", "0:00:05.00", "芽衣", "みじかい"),
    dialogue("0:00:05.00", "0:00:09.00", "优花", "またながい"),
    dialogue("0:00:09.00", "0:00:10.00", "芽衣", "はい"),
  ]), "多人.ass");
  assert.deepEqual(parsed.speakers, ["优花", "芽衣"]);
  assert.deepEqual(parsed.rows.map((row) => row.spk), ["优花", "芽衣", "优花", "芽衣"]);
});

test("typesetting styles are not people", () => {
  const parsed = parseAxisFile(ass([
    dialogue("0:00:00.00", "0:00:01.00", "JP", "せりふ"),
    dialogue("0:00:01.00", "0:00:02.00", "CN", "台词"),
  ]), "排版.ass");
  assert.deepEqual(parsed.speakers, []);
  assert.deepEqual(parsed.rows.map((row) => row.spk), ["", ""]);
});

test("comment tracks and Comment: lines are dropped, not counted", () => {
  const parsed = parseAxisFile(ass([
    dialogue("0:00:00.00", "0:00:01.00", "注释", "这里要压帧"),
    "Comment: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,被注释掉的一行",
    dialogue("0:00:02.00", "0:00:03.00", "Default", "残ったせりふ"),
  ]), "带注释.ass");
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.rows[0].ja, "残ったせりふ");
});

test("two events over the identical span merge into one bilingual row", () => {
  const parsed = parseAxisFile(ass([
    dialogue("0:00:01.00", "0:00:02.00", "JP", "{\\an8}こんにちは"),
    dialogue("0:00:01.00", "0:00:02.00", "CN", "你好"),
  ]), "双轨.ass");
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual([parsed.rows[0].ja, parsed.rows[0].zh], ["こんにちは", "你好"]);
});

test("a Format line with a different column order still reads", () => {
  const parsed = parseAxisFile(ass(
    ["Dialogue: 优花,0:00:01.00,0:00:02.00,0,,0,0,0,,せりふ, カンマ入り"],
    "Format: Style, Start, End, Layer, Name, MarginL, MarginR, MarginV, Effect, Text",
  ), "别的顺序.ass");
  assert.equal(parsed.rows.length, 1);
  // 正文里的逗号归 Text，不能被当成下一列
  assert.equal(parsed.rows[0].ja, "せりふ, カンマ入り");
});

test("overriding the detected kind re-columns without re-reading the file", () => {
  const parsed = parseAxisFile(ass([
    dialogue("0:00:01.00", "0:00:02.00", "Default", "全部漢字短句"),
    dialogue("0:00:03.00", "0:00:04.00", "Default", "另外一句"),
  ]), "全汉字.ass");
  assert.equal(parsed.kind, "zh");
  // 全汉字的日文短句会被判成中文轴；用户改判成日文轴时正文必须整段搬到原文列。
  assert.deepEqual(recolumn(parsed, "ja").map((row) => [row.ja, row.zh]),
    [["全部漢字短句", ""], ["另外一句", ""]]);
  // 判回空轴则只剩时间，正文清空——真空轴上的那些字是批注。
  assert.deepEqual(recolumn(parsed, "empty").map((row) => [row.ja, row.zh]), [["", ""], ["", ""]]);
  // 再改回来仍然拿得到原文：归列是从未归列的原始分段重算的。
  assert.deepEqual(recolumn(parsed, "zh").map((row) => row.zh), ["全部漢字短句", "另外一句"]);
});

test("zero-length and unparsable cues are skipped, not guessed", () => {
  const parsed = parseAxisFile(
    "1\n00:00:02,000 --> 00:00:02,000\n空\n\n2\n看不懂的时间行\n什么\n\n3\n00:00:05,000 --> 00:00:06,000\nのこり\n",
    "坏轴.srt",
  );
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.skipped, 2);
});
