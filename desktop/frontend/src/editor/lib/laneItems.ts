import { AGG_SPAN, AGG_W } from '../constants';
import { viewRange, viewStore, xOf } from '../store/viewStore';
import type { LaneItem, Seg } from '../types';

/** arr 按 t0 有序且同轨不重叠：二分找第一个可能落进窗口的句 */
function firstIn(arr: Seg[], tA: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t1 < tA) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * 一条 lane 在当前视口窗内要画的东西。窄于 AGG_W 的连片块并成一条「密度块」——
 * 这个缩放下本来也点不准，索性并起来，缩到全览时才不会一屏几千个 DOM。
 * 切片模式下区间外的句子一概不建：visWin 只钳了左边，右边可能溢出。
 */
export function laneItems(arr: Seg[], win: [number, number]): LaneItem[] {
  const pps = viewStore.get().pps;
  const out: LaneItem[] = [];
  const [vA, vB] = viewRange(arr);
  let i = Math.max(vA, firstIn(arr, win[0]));
  while (i < vB && arr[i].t0 <= win[1]) {
    const x0 = xOf(arr[i].t0);
    if ((arr[i].t1 - arr[i].t0) * pps >= AGG_W) { out.push({ kind: "blk", i, seg: arr[i] }); i++; continue; }
    // 并到「下一句不再紧挨着」或这条已经够长为止：一屏内的密度块数量因此有上限
    const i0 = i;
    let end = arr[i].t1;
    while (i + 1 < vB
      && (arr[i + 1].t1 - arr[i + 1].t0) * pps < AGG_W
      && (arr[i + 1].t0 - end) * pps < AGG_W
      && xOf(arr[i + 1].t1) - x0 < AGG_SPAN) { i++; end = arr[i].t1; }
    out.push(i > i0
      ? { kind: "agg", i0, i1: i, x: x0, w: xOf(end) - x0 }
      : { kind: "blk", i: i0, seg: arr[i0] });
    i++;
  }
  return out;
}
