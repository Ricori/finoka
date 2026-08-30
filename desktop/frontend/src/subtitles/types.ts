// 字幕拼装的公共数据形状。编辑器（就地可变的 Seg/Track）和插件宿主（从服务端读回的
// EditDocument）都能结构化地喂进来，两边于是共用同一条 ASS/SRT 拼装管线。

export type Lang = "ja" | "zh";

/** 一条 lane（原文/译文）的展示元数据 */
export interface LaneMeta {
  hidden: boolean;
  style: string | null;
}

export interface SubtitleSegment {
  t0: number;
  t1: number;
  ja: string;
  zh: string;
}

/** 自定义轨：与默认轨同构的双 lane */
export interface SubtitleTrack {
  name: string;
  ja: LaneMeta;
  zh: LaneMeta;
  segs: SubtitleSegment[];
}

/** 拼装一份字幕需要的全部文档内容 */
export interface SubtitleSource {
  segs: SubtitleSegment[];
  tracks: SubtitleTrack[];
  trackMeta: { name: string; ja: LaneMeta; zh: LaneMeta } | null;
}

/** ASS 样式表里解析出来的一个 Style */
export interface AssStyle {
  name: string;
  font: string;
  size: number;
  c1: string;
  c3: string;
  c4: string;
  bold: number;
  italic: number;
  scx: number;
  scy: number;
  sp: number;
  outline: number;
  shadow: number;
  align: number;
  ml: number;
  mr: number;
  mv: number;
}
