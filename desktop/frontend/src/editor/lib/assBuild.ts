import { ASS_EVENTS_HEAD } from '../constants';
import { assHead, fontsMissing, getStyleMap, resolveStyle } from '../ass';
import { docStore, trackName } from '../store/docStore';
import { assNm, assSec, assTs, assTx } from '../utils';
import type { Lang, Seg } from '../types';

/**
 * 把轨道拼成与 vod/api/edit.py::edit_export_ass 逐字相同的 ASS，交给 libass 渲染，
 * 于是预览和导出只差「谁来渲染」。拼装规则（线的优先级、组内排序、相邻重叠钳制）
 * 与那个接口一一对应，改一处必须同步改另一处，否则预览和导出会悄悄分家。
 */
interface OutLine { arr: Seg[]; lang: Lang; style: string; name: string }

/**
 * 输出线 = 堆叠优先级：默认轨 译文→原文 最贴边，再各自定义轨 译文→原文 依次向外。
 * 没绑样式的线不出现；绑了本机没有的样式则回退 JP/CN，不再整条线消失。
 */
export function outputLines(): OutLine[] {
  const { segs, tracks, trackMeta } = docStore.get();
  const out: OutLine[] = [];
  const add = (arr: Seg[], lang: Lang, style: string | null, name: string) => {
    if (style) out.push({ arr, lang, style: resolveStyle(style, lang), name });
  };
  if (trackMeta) {
    if (!trackMeta.zh.hidden) add(segs, "zh", trackMeta.zh.style, trackName(-1));
    if (!trackMeta.ja.hidden) add(segs, "ja", trackMeta.ja.style, trackName(-1));
  }
  tracks.forEach((tr, ti) => {
    if (!tr.zh.hidden) add(tr.segs, "zh", tr.zh.style, trackName(ti));
    if (!tr.ja.hidden) add(tr.segs, "ja", tr.ja.style, trackName(ti));
  });
  return out;
}

/**
 * 有绑定、但本机样式表里查不到的样式名。这些线会回退到 JP/CN 照常出图（见 outputLines），
 * 换了副样子却一声不响，所以打开文档时得拿它提一句。
 */
export function unknownStyles(): string[] {
  const { tracks, trackMeta } = docStore.get();
  const styleMap = getStyleMap();
  const miss = new Set<string>();
  const chk = (lane: { hidden: boolean; style: string | null } | undefined) => {
    if (lane && lane.style && !styleMap[lane.style]) miss.add(lane.style);
  };
  if (trackMeta) { chk(trackMeta.zh); chk(trackMeta.ja); }
  for (const tr of tracks) { chk(tr.zh); chk(tr.ja); }
  return [...miss];
}

export function buildAss(): string {
  const evs: string[] = [];
  for (const L of outputLines()) {
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
  return assHead() + ASS_EVENTS_HEAD + evs.join("\n") + "\n";
}

/**
 * 区间 ASS：buildAss() 与服务端 edit_export_ass 必须逐字一致，所以只在它外面包一层做
 * 区间变换——滤掉不相交的 Dialogue，其余把起止钳进区间后统一减去 T0。
 */
export function buildClipAss(T0: number, T1: number): string {
  const full = buildAss();
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

/** 当前会真的出现在画面上的那些样式所引用的字体里，系统找不到的那部分 */
export function missingFonts(): Promise<string[]> {
  const styleMap = getStyleMap();
  const names = new Set<string>();
  for (const L of outputLines()) {
    const st = styleMap[L.style];
    if (st && st.font) names.add(String(st.font).trim());
  }
  return fontsMissing([...names]);
}
