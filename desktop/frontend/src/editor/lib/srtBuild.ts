import { docStore } from '../store/docStore';
import { p2 } from '../utils';
import type { LaneMeta, Seg } from '../types';

export type SrtLang = "both" | "zh" | "ja";

/**
 * 把所有未隐藏轨道拼成 SRT，规则与 vod/api/edit.py::edit_export_srt 逐字相同
 * （改一处必须同步改另一处）。SRT 没有多轨概念，只能把各轨摊平成一条时间流：
 * 同时开口的两个人就是两条时间重叠的字幕，怎么摆由播放器决定。要保留轨道与样式走 ASS。
 */

interface Cue { t0: number; t1: number; text: string }

/** 秒 → SRT 时间码 HH:MM:SS,mmm */
function srtTs(sec: number): string {
  let ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, "0")}`;
}

const VISIBLE: LaneMeta = { hidden: false, style: null };

/**
 * lang: both=译文在上原文在下 / zh=只译文 / ja=只原文；被眼睛藏起来的 lane 不出
 * （与 ASS 导出同口径）。选中语言整条都空的句子跳过、序号按合并后的时间序重排——
 * 关掉翻译跑出来的产物译文全空，照原样出就是一份满是空块的坏 SRT。
 * T0/T1 给了就裁到那个区间并把时间轴平移到 0（切片导出）。
 */
export function buildSrt(lang: SrtLang, T0?: number, T1?: number): string {
  const { segs, tracks, trackMeta } = docStore.get();
  const clip = T0 !== undefined && T1 !== undefined;
  const cues: Cue[] = [];

  const collect = (arr: Seg[], ja: LaneMeta, zh: LaneMeta) => {
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
  collect(segs, trackMeta?.ja || VISIBLE, trackMeta?.zh || VISIBLE);
  for (const tr of tracks) collect(tr.segs, tr.ja, tr.zh);

  // 摊平成一条时间流。sort 是稳定的，同一时刻的多轨保持「默认轨在前」的收集顺序
  cues.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return cues.map((c, i) =>
    `${i + 1}\n${srtTs(c.t0)} --> ${srtTs(c.t1)}\n${c.text}\n\n`).join("");
}
