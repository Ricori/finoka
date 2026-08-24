import { createStore } from '../../home/lib/createStore';
import {
  BLK_MARGIN, CLIP_LANE_H, MIN_DUR, RULER_BASE, RULER_H0, ZOOM_FLOOR, ZOOM_MAX,
} from '../constants';
import { fmt } from '../utils';
import { curVp, innerLeft, syncTlMetrics, tlInner, tlScroll, tlStore } from './tlStore';
import type { Clip, Seg } from '../types';

/**
 * 视图窗口：完整片 = 0..duration，进切片后 = 切片的起止。
 * 时间数据（句子 t0/t1、播放头、peaks）一律是「原片绝对秒」，只有时间→像素和显示用的
 * 时间码按 t0 平移，所以存盘、ASS 生成、撤销栈都不用知道切片的存在。
 */
interface ViewState {
  duration: number;
  /** 初值必须和 duration 对齐：给 0 的话 setDuration() 之前的 fitPps() 会算出天文数字 */
  t0: number;
  t1: number;
  curClip: Clip | null;
  clips: Clip[];
  pps: number;                       // 像素/秒
  blkWin: [number, number] | null;   // 已渲染的字幕块时间窗
}

export const viewStore = createStore<ViewState>({
  duration: 60, t0: 0, t1: 60, curClip: null, clips: [], pps: 46, blkWin: null,
});

export const viewDur = () => { const v = viewStore.get(); return Math.max(0.001, v.t1 - v.t0); };
/** 绝对秒 → 时间轴像素 */
export const xOf = (t: number) => { const v = viewStore.get(); return (t - v.t0) * v.pps; };
/** 时间轴像素 → 绝对秒 */
export const tOf = (x: number) => { const v = viewStore.get(); return x / v.pps + v.t0; };
/** 面向用户的时间码（切片里从 00:00 起） */
export const fmtView = (t: number) => fmt(t - viewStore.get().t0);
/** 鼠标视口坐标 → 绝对秒 */
export const tAtClientX = (clientX: number) => tOf(clientX - innerLeft());

/**
 * 视图内的句子在数组里必然是连续一段（同轨按 t0 有序、无重叠），所以切片模式不过滤数组、
 * 只收窄下标区间——sel/selSet/撤销栈那套「下标即真实位置」的语义一个字都不用改。
 */
export function viewRange(arr: Seg[]): [number, number] {
  const v = viewStore.get();
  if (!v.curClip) return [0, arr.length];
  let a = 0, b = arr.length;
  while (a < arr.length && arr[a].t1 <= v.t0) a++;
  while (b > a && arr[b - 1].t0 >= v.t1) b--;
  return [a, b];
}

/**
 * 时长会来两次（先按 peaks/末句估，视频 loadedmetadata 后才是真值），每次都要重新对齐
 * 视图窗口——切片也得按新时长钳一遍，否则出点可能落在片尾之外
 */
export function setDuration(d: number) {
  const { curClip } = viewStore.get();
  if (curClip) {
    const t1 = Math.min(curClip.t1, d);
    viewStore.set({ duration: d, t1, t0: Math.max(0, Math.min(curClip.t0, t1 - MIN_DUR)) });
  } else {
    viewStore.set({ duration: d, t0: 0, t1: d });
  }
}

// ── 缩放 ──────────────────────────────────────────────────────────
/** 缩到最小时整条轴要能塞进视口：长视频下限就放宽到「全览」这一档 */
export const fitPps = () => {
  const w = tlStore.get().w;
  return (w > 0 && viewDur() > 0) ? w / viewDur() : ZOOM_FLOOR;
};
export const zoomMin = () => Math.min(ZOOM_FLOOR, fitPps());

// 滑块走对数刻度（0–1000 映射到 zoomMin()–ZOOM_MAX 像素/秒）：放大上限拉到 400px/s
// 后再用线性刻度的话，常用的几十 px/s 会全挤在最左边一小截里
export const sliderToPps = (v: number) => { const lo = zoomMin(); return lo * Math.pow(ZOOM_MAX / lo, v / 1000); };
export const ppsToSlider = (p: number) => {
  const lo = zoomMin();
  return Math.round(1000 * Math.log(Math.max(p, lo) / lo) / Math.log(ZOOM_MAX / lo));
};

/** 缩放到 np 像素/秒，锚点默认视口中心；传 anchorClientX 则以光标处时间为锚点 */
export function setZoom(np: number, anchorClientX?: number) {
  np = Math.min(Math.max(np, zoomMin()), ZOOM_MAX);
  if (np === viewStore.get().pps) return;
  // 视口先量齐，再一次性写回：中途读 DOM 会强制同步重排
  const vp = curVp();
  const scroll = tlScroll();
  const rect = scroll ? scroll.getBoundingClientRect() : ({ left: 0 } as DOMRect);
  const ax = anchorClientX != null
    ? Math.min(Math.max(anchorClientX - rect.left, 0), vp.w)
    : vp.w / 2;
  const at = tOf(vp.left + ax);   // 锚点对应的时间
  viewStore.set({ pps: np });
  // 先把 inner 宽度写到位再挪 scrollLeft，否则浏览器会按旧宽度把它钳回去
  // （React 稍后渲染出的宽度与这里一致，不会打架）
  applyInnerWidth();
  const left = Math.max(0, Math.min(xOf(at) - ax, viewDur() * np - vp.w));
  if (scroll) scroll.scrollLeft = left;
}

/** 视口宽或时长变了 → 全览这一档也跟着变：重新钳当前缩放 */
export function syncZoomRange() {
  const lo = zoomMin();
  if (viewStore.get().pps < lo - 1e-9) {
    viewStore.set({ pps: lo });
    applyInnerWidth();
    return true;
  }
  return false;
}

export function applyInnerWidth() {
  const inner = tlInner();
  if (inner) inner.style.width = (viewDur() * viewStore.get().pps) + "px";
}

/** 时长/缩放/可视尺寸变了之后的整体重排：宽度 → 指标 → 块窗口 */
export function relayout() {
  applyInnerWidth();
  syncTlMetrics();
  ensureBlkWin(true);
}

// ── 字幕块渲染窗 ──────────────────────────────────────────────────
// 块只画视口附近的一段：整轨几千句全建 DOM，缩放和滚动都会卡成幻灯片
let blkFrozen = false;
export const freezeBlocks = (v: boolean) => { blkFrozen = v; };

export function visWin(vp = curVp()): [number, number] {
  const vw = vp.w || 1;
  return [Math.max(viewStore.get().t0, tOf(vp.left - vw * BLK_MARGIN)), tOf(vp.left + vw * (1 + BLK_MARGIN))];
}

/** 视口滚出已渲染的窗口才补画（拖动中冻结） */
export function ensureBlkWin(force = false) {
  const vp = curVp();
  const win = viewStore.get().blkWin;
  if (!force) {
    if (blkFrozen || !win) return;
    if (tOf(vp.left) >= win[0] && tOf(vp.left + vp.w) <= win[1]) return;
  }
  viewStore.set({ blkWin: visWin(vp) });
}

// ── 切片布局 ──────────────────────────────────────────────────────
/**
 * 当前视图里要画哪些切片、各自摆第几层。切片可以互相嵌套，所以按时间贪心分层，
 * 重叠的往上摞。判重叠用时间而不是像素：像素随缩放变，层数会抖，标尺高度就一直在跳。
 */
export function clipLayout() {
  const { clips, t0, t1 } = viewStore.get();
  // 标记是用来指「它在哪儿」的，铺满整个视图的条一点位置信息都没有，纯噪声。
  // 当前进入的这个自己是这种情况；把它包在里面的上层切片也是——两者一并排除。
  const coversView = (c: Clip) => c.t0 <= t0 + 1e-6 && c.t1 >= t1 - 1e-6;
  const vis = clips
    .filter(c => !coversView(c) && c.t1 > t0 && c.t0 < t1)
    .sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  const laneEnd: number[] = [];   // 各层当前的右端时间
  const items = vis.map(c => {
    let k = laneEnd.findIndex(end => end <= c.t0);
    if (k < 0) { k = laneEnd.length; laneEnd.push(0); }
    laneEnd[k] = c.t1;
    return { c, lane: k };
  });
  return { items, lanes: laneEnd.length };
}

/** 标尺高度按切片层数算 */
export const rulerH = () => {
  const { lanes } = clipLayout();
  return lanes ? RULER_BASE + lanes * CLIP_LANE_H : RULER_H0;
};
