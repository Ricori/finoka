import { createStore } from '../../home/lib/createStore';
import { getVid } from '../session';
import type { Clip } from '../types';

/** 与主进程的 expJob() 是一对，改一处必须改另一处 */
export const expJob = () => "exp_" + getVid();

export const exportStore = createStore<{
  open: boolean;
  /** 本次导出的对象：null = 当前视图（完整片或已进入的切片） */
  clip: Clip | null;
  busy: boolean;
  pct: number;
}>({ open: false, clip: null, busy: false, pct: 0 });

export const openExport = (clip: Clip | null) =>
  exportStore.set({ open: true, clip, busy: false, pct: 0 });
