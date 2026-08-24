import { createStore } from '../../home/lib/createStore';

/**
 * 播放头、播放态与播放速率。单独一个 store：播放时 t 每帧都在变，跟别的状态放一起
 * 会让整个编辑器每秒重渲染 60 次；这里只有播放头、时间码、字幕预览这几个订阅者。
 */
export const playStore = createStore<{ t: number; playing: boolean; rate: number }>({
  t: 0, playing: false, rate: 1,
});
