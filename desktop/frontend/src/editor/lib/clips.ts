import { MIN_DUR } from '../constants';
import { saveClips } from '../store/saveStore';
import { deselect, selStore } from '../store/selectionStore';
import { askModal, modalStore, toast } from '../store/uiStore';
import { applyInnerWidth, ensureBlkWin, fitPps, setDuration, viewStore } from '../store/viewStore';
import { fmtDur, fmtHMS, round3 } from '../utils';
import { seek } from './playback';
import type { Clip } from '../types';

// 切片只是「原片上的一段命名区间」，字幕仍是原片那一份。存本地 library.json，
// 不进服务端那份文档，所以它不吃 rev 乐观锁，也不会和别人的编辑撞车。

/** 进/出切片：只改视图窗口，字幕数据一个字都不动 */
export function setView(clip: Clip | null) {
  modalStore.set({ clipTip: null });
  viewStore.set({ curClip: clip });
  setDuration(viewStore.get().duration);   // 由它按 curClip 重算 t0/t1
  deselect();
  viewStore.set({ pps: fitPps() });
  applyInnerWidth();
  ensureBlkWin(true);
  seek(viewStore.get().t0);
}

export const enterClip = (c: Clip) => setView(c);
export const exitClip = () => setView(null);

export async function newClipFromSelection() {
  const { selSet } = selStore.get();
  if (!selSet.size) { toast("先选中要做成切片的字幕块"); return; }
  let a = Infinity, b = -Infinity;
  for (const s of selSet) { a = Math.min(a, s.t0); b = Math.max(b, s.t1); }
  if (!(b > a)) { toast("选区时长为 0，做不了切片"); return; }
  const clips = viewStore.get().clips;
  const name = await askModal({
    title: "新建切片",
    hint: `区间 ${fmtHMS(a)} → ${fmtHMS(b)}（共 ${fmtDur(b - a)}），字幕仍与原片同一份`,
    value: "切片 " + (clips.length + 1),
  });
  if (name === null) return;
  const next = [...clips, {
    id: Math.random().toString(36).slice(2, 10),
    name: String(name).trim() || "切片 " + (clips.length + 1),
    t0: round3(a), t1: round3(b), createdAt: Date.now(),
  }].sort((x, y) => x.t0 - y.t0);
  viewStore.set({ clips: next });
  saveClips();
  toast("已新建切片");
}

export async function renameClip(c: Clip) {
  const name = await askModal({ title: "重命名切片", value: c.name });
  if (name === null) return;
  c.name = String(name).trim() || c.name;
  viewStore.set({ clips: [...viewStore.get().clips] });
  saveClips();
}

export async function removeClip(c: Clip) {
  const ok = await askModal({
    title: "删除切片",
    hint: `「${c.name}」只是个区间标记，删掉不影响字幕和视频。`,
    okLabel: "删除", danger: true,
  });
  if (!ok) return;
  viewStore.set({ clips: viewStore.get().clips.filter(x => x !== c) });
  saveClips();
  if (viewStore.get().curClip === c) exitClip();
}

/** 拖黄旗改起止。只动 clips，不碰字幕 */
export function commitClipEdge(c: Clip) {
  c.t0 = round3(c.t0); c.t1 = round3(c.t1);
  viewStore.set({ clips: [...viewStore.get().clips].sort((x, y) => x.t0 - y.t0) });
  saveClips();
}

export function dragClipEdgeTo(c: Clip, which: "l" | "r", tc: number) {
  if (which === "l") c.t0 = Math.max(0, Math.min(tc, c.t1 - MIN_DUR));
  else c.t1 = Math.min(viewStore.get().duration, Math.max(tc, c.t0 + MIN_DUR));
}
