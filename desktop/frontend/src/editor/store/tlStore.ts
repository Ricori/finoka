import { createStore } from '../../home/lib/createStore';

/**
 * 时间轴滚动容器的 DOM 引用与视口指标。拖动、缩放锚点、自动滚动都要读 scrollLeft/
 * clientWidth，统一从这里一次读齐（curVp）、写完再 sync——读写交错会强制同步重排，
 * 侧栏几千行列表在场时一次就是二三十毫秒。
 */
interface TlMetrics {
  left: number;       // scrollLeft
  w: number;          // clientWidth
  top: number;        // scrollTop
  h: number;          // clientHeight
  scrollH: number;    // scrollHeight
}

export const tlStore = createStore<TlMetrics>({ left: 0, w: 0, top: 0, h: 0, scrollH: 0 });

let scrollEl: HTMLDivElement | null = null;
let innerEl: HTMLDivElement | null = null;

export const setTlEls = (scroll: HTMLDivElement | null, inner: HTMLDivElement | null) => {
  scrollEl = scroll;
  innerEl = inner;
};
export const tlScroll = () => scrollEl;
export const tlInner = () => innerEl;

/** inner 的左边界（视口坐标）：把 clientX 换算成时间轴内像素要减它 */
export const innerLeft = () => innerEl ? innerEl.getBoundingClientRect().left : 0;

/** 视口快照：一次把 scrollLeft/尺寸读齐再动 DOM */
export function curVp(): TlMetrics {
  if (!scrollEl) return tlStore.get();
  return {
    left: scrollEl.scrollLeft, w: scrollEl.clientWidth,
    top: scrollEl.scrollTop, h: scrollEl.clientHeight, scrollH: scrollEl.scrollHeight,
  };
}

/** 把当前 DOM 指标同步进 store（滚动、缩放、行高变化后调用） */
export const syncTlMetrics = () => tlStore.set(curVp());

export const setScrollLeft = (v: number) => {
  if (!scrollEl) return;
  scrollEl.scrollLeft = v;
  syncTlMetrics();
};

export const setScrollTop = (v: number) => {
  if (!scrollEl) return;
  scrollEl.scrollTop = v;
  syncTlMetrics();
};

export const vMax = () => Math.max(0, tlStore.get().scrollH - tlStore.get().h);
