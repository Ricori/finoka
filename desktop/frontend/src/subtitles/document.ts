import { DEFAULT_STYLE_SHEET } from './constants.ts';
import { buildAssFrom, buildSrtFrom, clipAss } from './build.ts';
import type { SrtLang } from './build.ts';
import { composeSheet } from './styles.ts';
import type { SubtitleSource } from './types.ts';
import type { EditDocument } from '../documents/types.ts';

/**
 * 服务端读回的 EditDocument → 拼装管线的输入。编辑器把文档摊进 docStore 再拼，
 * 插件宿主没有 docStore，直接按同样的字段映射喂进去。
 */
export function sourceOfDocument(document: EditDocument): SubtitleSource {
  return {
    segs: document.subtitles ?? [],
    tracks: document.tracks ?? [],
    trackMeta: document.track_meta ?? null,
  };
}

/** 本机样式表原文（可能是空串：还没存过就用种子），与 styleStore 的口径一致 */
export const styleSheetText = (stored: string) => (stored.trim() ? stored : DEFAULT_STYLE_SHEET);

export interface SubtitleRange { t0: number; t1: number }

/** 文档 + 本机样式表 → ASS，与编辑器导出的那份逐字相同 */
export function documentAss(document: EditDocument, stored: string, range?: SubtitleRange): string {
  const full = buildAssFrom(sourceOfDocument(document), composeSheet(styleSheetText(stored)));
  return range ? clipAss(full, range.t0, range.t1) : full;
}

/** 文档 → SRT，与编辑器导出的那份逐字相同 */
export function documentSrt(document: EditDocument, lang: SrtLang, range?: SubtitleRange): string {
  const source = sourceOfDocument(document);
  return range ? buildSrtFrom(source, lang, range.t0, range.t1) : buildSrtFrom(source, lang);
}
