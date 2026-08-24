import { createStore } from '../../home/lib/createStore';
import { docStore, segsOf, trackName } from './docStore';
import { toast } from './uiStore';
import type { Seg, Ti } from '../types';

/**
 * 选中状态。selSet 存句对象引用而非下标——多选可跨轨，下标在各轨里各自计数、排序后还会
 * 串位。sel 是激活轨内的「主选中」下标（检查器/列表跟随它），始终是 selSet 的一员或 -1。
 */
interface SelState {
  curTrack: Ti;              // -1=默认轨，否则 tracks 下标
  sel: number;
  selSet: Set<Seg>;
  /** 框选进行中的实时命中预览：不动 selSet，落点才提交 */
  preview: Set<Seg> | null;
}

export const selStore = createStore<SelState>({
  curTrack: -1, sel: -1, selSet: new Set(), preview: null,
});

export const curSegs = () => segsOf(selStore.get().curTrack);

/** 块画不画选中框看这个：框选期间以预览集合为准 */
export const shownSel = () => selStore.get().preview || selStore.get().selSet;

// 主选中行可能被列表虚拟化掉了（没有 DOM），由列表组件注册滚动实现
let scrollRowIntoView: ((i: number) => void) | null = null;
export const registerRowScroller = (fn: ((i: number) => void) | null) => { scrollRowIntoView = fn; };

/** arr 内第一句被选中的下标，没有则 -1。选中集合/轨道要一起改时，先算好再一次性写 store */
const primaryIn = (selSet: Set<Seg>, arr: Seg[] = curSegs()) => arr.findIndex(s => selSet.has(s));

/** curTrack 内第一句被选中的下标当「主选中」，没有则 -1 */
export const primaryInTrack = () => primaryIn(selStore.get().selSet);

export function deselect() {
  selStore.set({ sel: -1, selSet: new Set(), preview: null });
}

/** 选中集合变化后，把主选中行滚到眼前 */
function afterSel(opt: { scroll?: boolean } = {}) {
  const { sel, selSet } = selStore.get();
  const cs = curSegs()[sel];
  if (cs && selSet.has(cs) && opt.scroll !== false) scrollRowIntoView?.(sel);
}

/** 一次性设定多选集合（框选用），入参是句引用数组（可跨轨） */
export function setSelectionSegs(list: Seg[], opt: { scroll?: boolean } = {}) {
  const selSet = new Set(list.filter(Boolean));
  selStore.set({ selSet, preview: null, sel: primaryIn(selSet) });
  afterSel(opt);
}

/** Ctrl/⌘ 点块：把 curTrack 里第 i 句加入/移出选中集合 */
export function toggleSel(i: number) {
  const arr = curSegs();
  const s = arr[i];
  if (!s) return;
  const { selSet, sel } = selStore.get();
  const next = new Set(selSet);
  const removed = next.delete(s);
  if (!removed) next.add(s);
  selStore.set({ selSet: next, sel: removed ? (sel === i ? primaryIn(next, arr) : sel) : i });
  afterSel();
}

/** Shift 点块：curTrack 内从主选中到该句连续区间全选 */
export function selectRange(a: number, b: number) {
  const arr = curSegs();
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const selSet = new Set<Seg>();
  for (let k = lo; k <= hi; k++) if (arr[k]) selSet.add(arr[k]);
  // 主选中落在最后点的那句，便于继续 Shift 扩选
  selStore.set({ selSet, preview: null, sel: b });
  afterSel();
}

export function select(i: number, opt: { scroll?: boolean } = {}) {
  const arr = curSegs();
  if (i < 0 || i >= arr.length) return;
  selStore.set({ sel: i, selSet: new Set([arr[i]]), preview: null });
  afterSel(opt);
}

/**
 * 切换激活轨（列表/检查器/快捷键都跟随它）。跨轨选中集合保留，只重算主选中，
 * 这样在别的轨上 Ctrl 点块能继续往同一集合里加。
 */
export function setActiveTrack(ti: Ti, opt: { silent?: boolean } = {}) {
  ti = Math.min(Math.max(ti, -1), docStore.get().tracks.length - 1);
  const { curTrack, selSet } = selStore.get();
  if (ti === curTrack) return;
  selStore.set({ curTrack: ti, sel: primaryIn(selSet, segsOf(ti)) });
  if (!opt.silent) toast("列表切换到「" + trackName(ti) + "」");
}

/** 撤销/重做恢复后重设选中（下标语义随快照一起回来） */
export function restoreSelection(curTrack: Ti, sel: number) {
  selStore.set({ curTrack, sel, selSet: new Set(), preview: null });
}
