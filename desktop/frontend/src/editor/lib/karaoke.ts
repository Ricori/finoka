import {
  canReadKaraoke, karaokeFromDuration, karaokeFromWords, karaokeGlyphs,
  karaokeMatches, normalizeWords,
} from '../../subtitles/karaoke';
import { bumpDoc, docStore, segsOf, trackName } from '../store/docStore';
import { markDirty } from '../store/saveStore';
import type { KaraokeUnit, Seg, Ti } from '../types';
import { pushHistory } from './history';
import { syncSubs } from './subtitles';

// K 轴（逐字时间）在编辑器这一侧的动作。只作用于原文：译文的字数和原文对不上，
// 逐字特效落到译文轴上时一律退回按字数均分（见 src/subtitles/karaoke.ts）。

export type KaraokeState = "ok" | "stale" | "none";

/** 这句 K 轴的状态：有且对得上 / 有但原文已改（会被忽略）/ 没有 */
export function karaokeStateOf(seg: Seg): KaraokeState {
  if (!seg.k?.length) return "none";
  return karaokeMatches(seg.k, seg.ja) ? "ok" : "stale";
}

export interface KaraokeSummary {
  ti: Ti;
  name: string;
  /** 有原文、能参与逐字的句子 */
  total: number;
  ok: number;
  stale: number;
  /** 还能从中间产物读出 K 轴的句子（含要覆盖掉的失效 K 轴） */
  readable: number;
}

export function karaokeSummary(ti: Ti): KaraokeSummary {
  const summary: KaraokeSummary = { ti, name: trackName(ti), total: 0, ok: 0, stale: 0, readable: 0 };
  for (const seg of segsOf(ti)) {
    if (!karaokeGlyphs(seg.ja).length) continue;
    summary.total++;
    const state = karaokeStateOf(seg);
    if (state === "ok") summary.ok++;
    else if (state === "stale") summary.stale++;
    if (state !== "ok" && canReadKaraoke(seg)) summary.readable++;
  }
  return summary;
}

/** 编辑器里能挂 K 轴的轨：默认轨 + 每条自定义轨 */
export const karaokeTracks = (): Ti[] => [-1, ...docStore.get().tracks.map((_, index) => index)];

const commit = () => { bumpDoc(); syncSubs(); markDirty(); };

interface ApplyResult { applied: number; skipped: number }

/**
 * 从中间产物（stable.json 的词级时间戳，投影时已挂在句上）读逐字时间。
 * overwrite=false 时只补没有 K 轴的句子，已经手动调过的那些不动。
 */
export function readKaraokeFromWords(ti: Ti, overwrite: boolean): ApplyResult {
  const next = new Map<Seg, KaraokeUnit[]>();
  let skipped = 0;                       // 想读但读不出来的句子；已经就绪的不算在内
  for (const seg of segsOf(ti)) {
    if (!karaokeGlyphs(seg.ja).length) continue;
    if (!overwrite && karaokeStateOf(seg) === "ok") continue;
    const units = karaokeFromWords(seg.ja, seg.t0, seg.t1, normalizeWords(seg.words));
    if (units) next.set(seg, units);
    else skipped++;
  }
  if (!next.size) return { applied: 0, skipped };
  pushHistory();
  for (const [seg, units] of next) seg.k = units;
  commit();
  return { applied: next.size, skipped };
}

/** 按字数均分整句：没有词级时间戳的句子的兜底，也是「重置这条轨」的入口 */
export function spreadKaraokeEvenly(ti: Ti, onlyMissing: boolean): ApplyResult {
  const segs = segsOf(ti);
  const next = new Map<Seg, KaraokeUnit[]>();
  for (const seg of segs) {
    if (!karaokeGlyphs(seg.ja).length) continue;
    if (onlyMissing && karaokeStateOf(seg) === "ok") continue;
    next.set(seg, karaokeFromDuration(seg.ja, seg.t0, seg.t1));
  }
  if (!next.size) return { applied: 0, skipped: 0 };
  pushHistory();
  for (const [seg, units] of next) seg.k = units;
  commit();
  return { applied: next.size, skipped: 0 };
}

export function clearKaraoke(ti: Ti): number {
  const segs = segsOf(ti).filter(seg => seg.k?.length);
  if (!segs.length) return 0;
  pushHistory();
  for (const seg of segs) delete seg.k;
  commit();
  return segs.length;
}

/** 单句：重新从中间产物读，读不到就按字数均分 */
export function resetKaraokeOf(seg: Seg): boolean {
  if (!karaokeGlyphs(seg.ja).length) return false;
  const units = karaokeFromWords(seg.ja, seg.t0, seg.t1, normalizeWords(seg.words))
    ?? karaokeFromDuration(seg.ja, seg.t0, seg.t1);
  pushHistory();
  seg.k = units;
  commit();
  return true;
}
