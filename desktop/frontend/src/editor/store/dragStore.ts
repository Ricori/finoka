import { createStore } from '../../home/lib/createStore';
import type { Ti } from '../types';

/** 时间轴上正在进行的拖拽：框选矩形、跨轨拖动时高亮的目标轨 */
export const dragStore = createStore<{
  marquee: { left: number; top: number; w: number; h: number } | null;
  dropTi: Ti | null;
}>({ marquee: null, dropTi: null });
