import assert from "node:assert/strict";
import test from "node:test";

import { documentAss, documentSrt } from "../src/subtitles/document.ts";
import { DEFAULT_STYLE_SHEET } from "../src/subtitles/constants.ts";

// 编辑器（docStore）和插件宿主（服务端读回的 EditDocument）现在共用 src/subtitles
// 这一条拼装管线，所以这里盯的是管线本身的口径：谁贴边、谁不出、重叠怎么钳。

const document = {
  schema: 1,
  video_id: "loc_fixture",
  title: "fixture.mp4",
  source: "task",
  fp: null,
  rev: 4,
  subtitles: [
    { t0: 1.2, t1: 3.5, ja: "こんにちは", zh: "你好" },
    { t0: 3.4, t1: 5, ja: "二行目", zh: "第二行\n继续" },
  ],
  tracks: [{
    id: "tr1",
    name: "注释",
    ja: { hidden: true, style: "JP" },
    zh: { hidden: false, style: "注释" },
    hja: 48,
    hzh: 48,
    segs: [{ t0: 6, t1: 7, ja: "隠れる", zh: "旁白" }],
  }],
  track_meta: { name: "默认轨", ja: { hidden: false, style: "JP" }, zh: { hidden: false, style: "CN" } },
  projection: { schema: 1, mode: "final" },
};

test("文档拼出的 ASS 只出未隐藏的 lane，并钳掉同线相邻句的重叠", () => {
  const ass = documentAss(document, DEFAULT_STYLE_SHEET);
  assert.match(ass, /Dialogue: 0,0:00:01\.20,0:00:03\.40,CN,默认轨,0,0,0,,你好/);
  assert.match(ass, /Dialogue: 0,0:00:01\.20,0:00:03\.40,JP,默认轨,0,0,0,,こんにちは/);
  assert.match(ass, /Dialogue: 0,0:00:06\.00,0:00:07\.00,注释,注释,0,0,0,,旁白/);
  // 藏起来的原文 lane 不出图
  assert.ok(!ass.includes("隠れる"));
  // 1.2–3.5 撞上 3.4 开口的下一句，前句出点被钳到 3.40
  assert.ok(!ass.includes("0:00:03.50"));
  // 换行转义，译文在前的堆叠顺序保持不变
  assert.ok(ass.indexOf("第二行\\N继续") < ass.indexOf("二行目"));
});

test("样式表为空时回落到种子，JP/CN 始终存在", () => {
  const seeded = documentAss(document, "   ");
  assert.match(seeded, /\[V4\+ Styles\]\nFormat: Name, Fontname, Fontsize, PrimaryColour,/);
  assert.match(seeded, /Style: JP,/);
  assert.match(seeded, /Style: CN,/);
  assert.match(seeded, /Style: 注释,/);
});

test("绑到本机没有的样式回退 JP/CN，整条线不会消失", () => {
  const bound = { ...document, track_meta: { name: "默认轨", ja: { hidden: false, style: "不存在" }, zh: { hidden: false, style: "也不存在" } } };
  const ass = documentAss(bound, DEFAULT_STYLE_SHEET);
  assert.match(ass, /,JP,默认轨,0,0,0,,こんにちは/);
  assert.match(ass, /,CN,默认轨,0,0,0,,你好/);
});

test("区间 ASS 只留相交的行并把时间轴平移到 0", () => {
  const clip = documentAss(document, DEFAULT_STYLE_SHEET, { t0: 3.4, t1: 7 });
  assert.ok(!clip.includes("你好"));
  assert.match(clip, /Dialogue: 0,0:00:00\.00,0:00:01\.60,CN,默认轨,0,0,0,,第二行\\N继续/);
  assert.match(clip, /Dialogue: 0,0:00:02\.60,0:00:03\.60,注释,注释/);
});

test("SRT 摊平成一条时间流，按语言筛选并重排序号", () => {
  assert.match(documentSrt(document, "both"), /^1\n00:00:01,200 --> 00:00:03,500\n你好\nこんにちは\n/);
  assert.ok(!documentSrt(document, "zh").includes("こんにちは"));
  assert.ok(!documentSrt(document, "ja").includes("你好"));
  // 藏起来的 lane 在 SRT 里同样不出
  assert.ok(!documentSrt(document, "both").includes("隠れる"));
  assert.match(documentSrt(document, "both", { t0: 6, t1: 7 }), /^1\n00:00:00,000 --> 00:00:01,000\n旁白\n\n$/);
});
