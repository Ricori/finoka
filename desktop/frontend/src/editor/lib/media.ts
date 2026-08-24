// <video> 与字幕画布的元素注册处：组件挂载时登记，命令式逻辑（播放、擦洗音、
// 字幕渲染）从这里拿元素，免得到处传 ref 或退回 getElementById。

let videoEl: HTMLVideoElement | null = null;
let subCanvasEl: HTMLCanvasElement | null = null;

export const setVideoEl = (el: HTMLVideoElement | null) => { videoEl = el; };
export const video = () => videoEl;

export const setSubCanvasEl = (el: HTMLCanvasElement | null) => { subCanvasEl = el; };
export const subCanvas = () => subCanvasEl;

/** 视频可能还没就绪，写 currentTime 会抛，统一咽掉 */
export function safeSeekVideo(t: number) {
  const v = videoEl;
  if (!v) return;
  try { v.currentTime = t; } catch { /* 未就绪 */ }
}
