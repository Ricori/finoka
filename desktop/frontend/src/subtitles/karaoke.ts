// K 轴（逐字时间）：只用于原文 lane。
//
// 编辑器的句子本来只有起止时间，逐字特效于是只能把整句均分——歌词跟着人声走，
// 均分出来的字必然对不上。转写的中间产物（stable.json）里带着词级时间戳，
// 投影时已经原样挂在句上（Seg.words），这里把它切成逐字的 K 轴。

import type { KaraokeUnit, SubtitleSegment } from './types.ts';

export interface WordTiming { text: string; t0: number; t1: number }

/** 中间产物里的一个词：{ word, start, end }，别的字段一律不认 */
export function normalizeWords(value: unknown): WordTiming[] {
  if (!Array.isArray(value)) return [];
  const out: WordTiming[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const text = String(raw.word ?? raw.text ?? "");
    const t0 = Number(raw.start ?? raw.t0);
    const t1 = Number(raw.end ?? raw.t1);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) continue;
    out.push({ text, t0, t1 });
  }
  return out.sort((left, right) => left.t0 - right.t0);
}

export function normalizeKaraoke(value: unknown): KaraokeUnit[] {
  if (!Array.isArray(value)) return [];
  const out: KaraokeUnit[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const t0 = Number(raw.t0), t1 = Number(raw.t1);
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) continue;
    out.push({ t0, t1, text: String(raw.text ?? "") });
  }
  return out;
}

/** 参与逐字的字形：空白不单独成字，跟在前一个字后面（和 ASS 音节一个口径） */
export const karaokeGlyphs = (text: string): string[] => {
  const out: string[] = [];
  for (const glyph of Array.from((text || "").replace(/\r/g, "").replace(/\n/g, " "))) {
    if (/^\s$/u.test(glyph) && out.length) out[out.length - 1] += glyph;
    else if (!/^\s$/u.test(glyph)) out.push(glyph);
  }
  return out;
};

const stripSpace = (text: string) => text.replace(/\s+/gu, "");

/** 一个 K 段覆盖几个字形。段可以是一个词，也可以是单字 */
export const unitGlyphs = (unit: KaraokeUnit): number => karaokeGlyphs(unit.text).length;

/** K 轴还对得上这句原文吗：覆盖的字数一致即认（改过错别字不该让 K 轴作废） */
export function karaokeMatches(units: KaraokeUnit[] | undefined, text: string): boolean {
  if (!units?.length) return false;
  return units.reduce((sum, unit) => sum + unitGlyphs(unit), 0) === karaokeGlyphs(text).length;
}

/** 把 [t0,t1] 按字数均分——没有词级时间戳时的兜底，也是手动重置的入口 */
export function karaokeFromDuration(text: string, t0: number, t1: number): KaraokeUnit[] {
  const glyphs = karaokeGlyphs(text);
  if (!glyphs.length) return [];
  const span = Math.max(0, t1 - t0);
  return glyphs.map((glyph, index) => ({
    t0: t0 + span * index / glyphs.length,
    t1: t0 + span * (index + 1) / glyphs.length,
    text: glyph,
  }));
}

/**
 * 词级时间戳 → 逐词 K 轴：一个词一段，整词一起亮。
 *
 * 早先是把词的时长再按字数均分成逐字段的，但 whisper 系只给到词边界，词内的字级
 * 时间是编出来的——唱腔并不均匀，编出来的节奏反而比整词一起亮更难看。词间空档
 * 并进前一个词，于是 K 轴连续覆盖整句，逐字特效不会闪断。
 *
 * 中间产物的词时间来自 stable 段，而句子的起止在 final 模式下取自最终 SRT，
 * 两者可能整体错位；词跨度落在句外就先线性映射回句内，落在句内则只做钳位。
 */
export function karaokeFromWords(text: string, t0: number, t1: number,
  words: WordTiming[]): KaraokeUnit[] | null {
  const glyphs = karaokeGlyphs(text);
  const usable = words.filter(word => stripSpace(word.text).length);
  if (!glyphs.length || !usable.length) return null;
  const wordGlyphs = usable.map(word => karaokeGlyphs(word.text).length);
  const covered = wordGlyphs.reduce((sum, count) => sum + count, 0);
  if (covered !== glyphs.length) return null;

  const spanStart = usable[0].t0;
  const spanEnd = Math.max(spanStart, usable[usable.length - 1].t1);
  const outside = spanStart < t0 - .05 || spanEnd > t1 + .05;
  const scale = outside && spanEnd > spanStart ? (t1 - t0) / (spanEnd - spanStart) : 1;
  const at = (value: number) => outside
    ? t0 + (value - spanStart) * scale
    : Math.min(t1, Math.max(t0, value));

  const units: KaraokeUnit[] = [];
  let index = 0;
  usable.forEach((word, wordIndex) => {
    // 词间空档并进本词，最后一个词一路接到句尾：K 轴不留缝
    const start = at(word.t0);
    const end = wordIndex + 1 < usable.length ? at(usable[wordIndex + 1].t0) : Math.max(at(word.t1), t1);
    // 文本取原文里对应的那几个字，而不是词表里的写法：错别字改过之后仍然对得上
    const span = glyphs.slice(index, index + wordGlyphs[wordIndex]).join("");
    index += wordGlyphs[wordIndex];
    units.push({ t0: start, t1: Math.max(start, end), text: span });
  });
  units[0].t0 = t0;
  units[units.length - 1].t1 = t1;
  return units;
}

/** 这句能不能从中间产物读出 K 轴 */
export const canReadKaraoke = (segment: SubtitleSegment): boolean =>
  !!karaokeFromWords(segment.ja || "", segment.t0, segment.t1, normalizeWords(segment.words));

/**
 * 逐字特效实际用的时间轴：把 K 段摊成逐字——一个词里的字共用这个词的窗口，
 * 于是整词一起亮。没有对得上的 K 轴就按字数均分整句；原文改过、K 轴对不上了
 * 也退回均分：宁可节奏不准，也不该错位到别的字上。
 */
export function karaokeTimeline(text: string, t0: number, t1: number,
  units: KaraokeUnit[] | undefined): { units: KaraokeUnit[]; fromK: boolean } {
  if (!karaokeMatches(units, text)) return { units: karaokeFromDuration(text, t0, t1), fromK: false };
  const glyphs = karaokeGlyphs(text);
  const out: KaraokeUnit[] = [];
  let index = 0;
  for (const unit of units!) {
    for (let n = unitGlyphs(unit); n > 0; n--) out.push({ t0: unit.t0, t1: unit.t1, text: glyphs[index++] });
  }
  return { units: out, fromK: true };
}
