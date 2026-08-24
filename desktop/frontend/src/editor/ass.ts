import { ASS_FMT_DEFAULT, BUNDLED_FONTS } from './constants';
import { assColor } from './utils';
import type { AssStyle } from './types';

// ASS 模板解析（预览渲染 + 绑定下拉共用）。只解析 Style 行 + PlayRes；
// Format 行决定字段顺序，缺省用标准 23 字段。解析结果是模块级单例：
// 模板是全局的，一份解析全编辑器共用。

let styleMap: Record<string, AssStyle> = {};
let styleNames: string[] = [];
let playRes = { x: 1920, y: 1080 };

export const getStyleMap = () => styleMap;
export const getStyleNames = () => styleNames;
export const getPlayRes = () => playRes;

export function parseAssTemplate(text: string) {
  styleMap = {};
  styleNames = [];
  playRes = { x: 1920, y: 1080 };
  let fmtKeys = ASS_FMT_DEFAULT;
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim(), low = line.toLowerCase();
    if (low.startsWith("[events]")) break;   // Events 段（若有）不解析
    if (low.startsWith("playresx:")) { playRes.x = +line.slice(9).trim() || 1920; continue; }
    if (low.startsWith("playresy:")) { playRes.y = +line.slice(9).trim() || 1080; continue; }
    if (low.startsWith("format:")) { fmtKeys = low.slice(7).split(",").map(s => s.trim()); continue; }
    if (!low.startsWith("style:")) continue;
    const parts = line.slice(6).split(",").map(s => s.trim());
    const g = (k: string) => { const i = fmtKeys.indexOf(k); return i >= 0 && i < parts.length ? parts[i] : ""; };
    const st: AssStyle = {
      name: g("name"), font: g("fontname"), size: +g("fontsize") || 70,
      c1: g("primarycolour"), c3: g("outlinecolour"), c4: g("backcolour"),
      bold: +g("bold") || 0, italic: +g("italic") || 0,
      scx: +g("scalex") || 100, scy: +g("scaley") || 100, sp: +g("spacing") || 0,
      outline: +g("outline") || 0, shadow: +g("shadow") || 0,
      align: +g("alignment") || 2,
      ml: +g("marginl") || 0, mr: +g("marginr") || 0, mv: +g("marginv") || 0,
    };
    if (st.name && !styleMap[st.name]) { styleMap[st.name] = st; styleNames.push(st.name); }
  }
}

/** 样式的主色，统一成 rgb() 形式（调用方要拆出 "r,g,b" 拼透明度） */
export function styleRgb(name: string | null, fallback: string): string {
  const st = name ? styleMap[name] : null;
  if (st) { const c = assColor(st.c1); return `rgb(${c.rgb.join(",")})`; }
  return fallback;
}

// ── 缺字检测 ──────────────────────────────────────────────
// 随包字体之外，模板里引用的字体得靠系统装了同名的。
// document.fonts.check() 对本地字体不可靠，用经典的 canvas 宽度比对法：
// 拿目标字体和一个必然不存在的族名量同一串字，宽度不同就说明目标字体真被用上了。
const PROBE = "汉字AWMil測試0123";
const BOGUS = '"__nonoka_no_such_font__"';
const cssFam = (n: string) => `"${n.replace(/["\\]/g, "\\$&")}"`;

/**
 * 批量查缺字。必须是异步的：@font-face 声明的字体是懒加载的，
 * 没先 load 一遍就量宽，量到的是回退字体，会把装着的字体误报成缺失。
 */
export async function fontsMissing(names: string[]): Promise<string[]> {
  const list = names.filter(n => n && !BUNDLED_FONTS.some(f => f.toLowerCase() === n.toLowerCase()));
  if (!list.length) return [];
  await Promise.all(list.map(n => document.fonts.load(`40px ${cssFam(n)}`, PROBE).catch(() => {})));
  await document.fonts.ready;
  const cv = document.createElement("canvas").getContext("2d");
  if (!cv) return [];
  const width = (f: string) => { cv.font = `40px ${f}`; return cv.measureText(PROBE).width; };
  const bogus = width(BOGUS);
  return list.filter(n => width(`${cssFam(n)}, ${BOGUS}`) === bogus);
}
