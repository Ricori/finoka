import { WAVE_GAIN_MAX, WAVE_GAIN_STEPS } from '../constants';
import { docStore } from '../store/docStore';
import { layoutStore, saveLayout } from '../store/layoutStore';

export function waveAmp(time: number): number {
  const { peaks, segs } = docStore.get();
  if (peaks?.peaks?.length) {
    const idx = Math.floor(time * (peaks.per_sec || 20));
    return peaks.peaks[idx] || 0;
  }
  // 波形未就绪时退伪包络（与字幕区间联动），能看出大致节奏
  const inSeg = segs.some(s => time >= s.t0 - 0.08 && time <= s.t1 + 0.08);
  if (!inSeg) return 0.05;
  return 0.2 + Math.abs(Math.sin(time * 5.2) * .6 + Math.sin(time * 8.7 + 2) * .4) * 0.6;
}

// 自动增益：把整条音轨的最大峰值顶到 0.92 满格（峰值算不出就按 1 倍）。
// peaks 一次载入不再变，算完缓存
let autoGainCache: number | null = null;
export const resetAutoGain = () => { autoGainCache = null; };

export function autoGain(): number {
  if (autoGainCache != null) return autoGainCache;
  const peaks = docStore.get().peaks;
  if (!peaks?.peaks?.length) return 1;   // 未就绪先按 1 倍，别把缓存钉死
  let mx = 0;
  for (const p of peaks.peaks) if (p > mx) mx = p;
  autoGainCache = mx > 1e-4 ? Math.min(Math.max(0.92 / mx, 1), WAVE_GAIN_MAX) : 1;
  return autoGainCache;
}

export const effGain = () => {
  const g = layoutStore.get().waveGain;
  return g > 0 ? g : autoGain();
};

export function setWaveGain(v: number) {
  layoutStore.set({ waveGain: Math.min(Math.max(v, 0), WAVE_GAIN_MAX) });
  saveLayout();
}

/** 自动档在预设序列里排在 1× 之前，按 0 参与索引 */
export function stepWaveGain(dir: number) {
  const seq = [0, ...WAVE_GAIN_STEPS];
  const cur = layoutStore.get().waveGain;
  let i = seq.indexOf(cur);
  if (i < 0) {   // 当前值不在预设上（旧存档），就近取一档
    i = seq.findIndex(v => v > cur);
    if (i < 0) i = seq.length - 1;
    if (dir > 0) i--;
  }
  setWaveGain(seq[(i + dir + seq.length) % seq.length]);
}
