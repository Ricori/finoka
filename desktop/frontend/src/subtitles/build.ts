import { ASS_EVENTS_HEAD } from './constants.ts';
import { assNm, assSec, assTs, assTx, srtTs } from './format.ts';
import { assHeadOf, resolveStyleIn } from './styles.ts';
import type { StyleSheet } from './styles.ts';
import type { Lang, LaneMeta, SubtitleSegment, SubtitleSource } from './types.ts';

/**
 * 文档 → ASS/SRT 的拼装管线，与 vod/api/edit.py::edit_export_ass / edit_export_srt
 * 逐字相同（改一处必须同步改另一处）。编辑器拿 docStore 的就地可变文档喂进来，
 * 插件宿主拿服务端读回的 EditDocument 喂进来，于是插件拿到的字幕与编辑器导出的
 * 那份、以及 libass 正在预览的那份，是同一条代码路径出的结果。
 */
export interface OutputLine { arr: SubtitleSegment[]; lang: Lang; style: string; name: string }

/** ti：-1 = 默认轨，否则自定义轨下标 */
export function trackNameOf(source: SubtitleSource, ti: number): string {
  return ti < 0
    ? (source.trackMeta?.name || "默认轨")
    : (source.tracks[ti]?.name || ("轨道 " + (ti + 1)));
}

/**
 * 输出线 = 堆叠优先级：默认轨 译文→原文 最贴边，再各自定义轨 译文→原文 依次向外。
 * 没绑样式的线不出现；绑了本机没有的样式则回退 JP/CN，不再整条线消失。
 */
export function outputLinesOf(source: SubtitleSource, sheet: StyleSheet): OutputLine[] {
  const out: OutputLine[] = [];
  const add = (arr: SubtitleSegment[], lang: Lang, style: string | null, name: string) => {
    if (style) out.push({ arr, lang, style: resolveStyleIn(sheet, style, lang), name });
  };
  const meta = source.trackMeta;
  if (meta) {
    if (!meta.zh.hidden) add(source.segs, "zh", meta.zh.style, trackNameOf(source, -1));
    if (!meta.ja.hidden) add(source.segs, "ja", meta.ja.style, trackNameOf(source, -1));
  }
  source.tracks.forEach((tr, ti) => {
    if (!tr.zh.hidden) add(tr.segs, "zh", tr.zh.style, trackNameOf(source, ti));
    if (!tr.ja.hidden) add(tr.segs, "ja", tr.ja.style, trackNameOf(source, ti));
  });
  return out;
}

/** 有绑定、但样式表里查不到的样式名（这些线会回退到 JP/CN 照常出图） */
export function unknownStylesOf(source: SubtitleSource, sheet: StyleSheet): string[] {
  const miss = new Set<string>();
  const chk = (lane: LaneMeta | undefined) => {
    if (lane && lane.style && !sheet.styleMap[lane.style]) miss.add(lane.style);
  };
  if (source.trackMeta) { chk(source.trackMeta.zh); chk(source.trackMeta.ja); }
  for (const tr of source.tracks) { chk(tr.zh); chk(tr.ja); }
  return [...miss];
}

export function buildAssFrom(source: SubtitleSource, sheet: StyleSheet): string {
  const evs: string[] = [];
  for (const L of outputLinesOf(source, sheet)) {
    // 组内按时间排：全片一起排会让晚开口的高优先级线被挤走
    const g = L.arr.filter(s => (s[L.lang] || "").trim())
      .map(s => ({ t0: s.t0, t1: s.t1, text: assTx(s[L.lang]) }))
      .sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
    // 同一条线内相邻句的毫秒级重叠（ASR 数据自带）会被当成碰撞，
    // 把后一句整句顶离贴边位——前句出点一律钳到后句入点
    for (let i = 0; i < g.length - 1; i++)
      if (g[i].t1 > g[i + 1].t0) g[i].t1 = g[i + 1].t0;
    for (const e of g)
      evs.push(`Dialogue: 0,${assTs(e.t0)},${assTs(e.t1)},${L.style},${assNm(L.name)},0,0,0,,${e.text}`);
  }
  return assHeadOf(sheet) + ASS_EVENTS_HEAD + evs.join("\n") + "\n";
}

/**
 * 区间 ASS：整片那份必须与服务端逐字一致，所以只在它外面包一层做区间变换——
 * 滤掉不相交的 Dialogue，其余把起止钳进区间后统一减去 T0。
 */
export function clipAss(full: string, T0: number, T1: number): string {
  const i = full.indexOf("Dialogue:");
  if (i < 0) return full;
  const head = full.slice(0, i);
  const out: string[] = [];
  for (const line of full.slice(i).split("\n")) {
    const m = /^Dialogue: (\d+),([^,]+),([^,]+),(.*)$/.exec(line);
    if (!m) continue;
    const a = assSec(m[2]), b = assSec(m[3]);
    if (b <= T0 || a >= T1) continue;
    out.push(`Dialogue: ${m[1]},${assTs(Math.max(a, T0) - T0)},${assTs(Math.min(b, T1) - T0)},${m[4]}`);
  }
  return head + out.join("\n") + "\n";
}

export type SrtLang = "both" | "zh" | "ja";

interface Cue { t0: number; t1: number; text: string }

const VISIBLE: LaneMeta = { hidden: false, style: null };

/**
 * lang: both=译文在上原文在下 / zh=只译文 / ja=只原文；被眼睛藏起来的 lane 不出
 * （与 ASS 导出同口径）。选中语言整条都空的句子跳过、序号按合并后的时间序重排——
 * 关掉翻译跑出来的产物译文全空，照原样出就是一份满是空块的坏 SRT。
 * T0/T1 给了就裁到那个区间并把时间轴平移到 0（切片导出）。
 */
export function buildSrtFrom(source: SubtitleSource, lang: SrtLang, T0?: number, T1?: number): string {
  const clip = T0 !== undefined && T1 !== undefined;
  const cues: Cue[] = [];

  const collect = (arr: SubtitleSegment[], ja: LaneMeta, zh: LaneMeta) => {
    for (const s of arr) {
      if (clip && (s.t1 <= T0! || s.t0 >= T1!)) continue;
      const lines: string[] = [];
      if (lang !== "ja" && !zh.hidden && (s.zh || "").trim()) lines.push(s.zh);
      if (lang !== "zh" && !ja.hidden && (s.ja || "").trim()) lines.push(s.ja);
      if (!lines.length) continue;
      cues.push({
        t0: clip ? Math.max(s.t0, T0!) - T0! : s.t0,
        t1: clip ? Math.min(s.t1, T1!) - T0! : s.t1,
        text: lines.join("\n"),
      });
    }
  };
  collect(source.segs, source.trackMeta?.ja || VISIBLE, source.trackMeta?.zh || VISIBLE);
  for (const tr of source.tracks) collect(tr.segs, tr.ja, tr.zh);

  // 摊平成一条时间流。sort 是稳定的，同一时刻的多轨保持「默认轨在前」的收集顺序
  cues.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return cues.map((c, i) =>
    `${i + 1}\n${srtTs(c.t0)} --> ${srtTs(c.t1)}\n${c.text}\n\n`).join("");
}
