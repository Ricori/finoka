import { ASS_FMT_DEFAULT, ASS_STYLE_FORMAT, BUILTIN_ASS_STYLES, BUNDLED_FONTS } from './constants.ts';
import { assColor } from './utils.ts';
import type { AssStyle, Lang } from './types';

// 样式表解析（预览渲染 + 绑定下拉 + 导出共用）。样式存在本机（见 store/styleStore），
// 这里只管把「本机样式表 + 写死的 JP/CN」合成一份：解析结果和规范化后的 [V4+ Styles]
// 段都是模块级单例，样式是全局的，一份解析全编辑器共用。

/** Format 行没列到的字段用这里的值补齐，取值同 Aegisub 新建样式 */
const FIELD_FALLBACK: Record<string, string> = {
  name: "", fontname: "方正准圆_GBK", fontsize: "70",
  primarycolour: "&H00FFFFFF", secondarycolour: "&H000000FF",
  outlinecolour: "&H00000000", backcolour: "&H00000000",
  bold: "0", italic: "0", underline: "0", strikeout: "0",
  scalex: "100", scaley: "100", spacing: "0", angle: "0",
  borderstyle: "1", outline: "2", shadow: "2", alignment: "2",
  marginl: "10", marginr: "10", marginv: "30", encoding: "1",
};

/** 一条 Style 行拆成「字段名 → 原文」，保留 AssStyle 里没有的字段（副色/描边样式/编码等） */
type StyleFields = Record<string, string>;

interface Sheet {
  order: string[];
  fields: Record<string, StyleFields>;
  playRes: { x: number; y: number } | null;
}

let styleMap: Record<string, AssStyle> = {};
let styleNames: string[] = [];
let playRes = { x: 1920, y: 1080 };
let stylesBlock = "";

export const getStyleMap = () => styleMap;
export const getStyleNames = () => styleNames;
export const getPlayRes = () => playRes;

/** 只解析 Style 行 + PlayRes；Format 行决定字段顺序，缺省用标准 23 字段 */
export function parseSheet(text: string): Sheet {
  const sheet: Sheet = { order: [], fields: {}, playRes: null };
  let fmtKeys = ASS_FMT_DEFAULT;
  for (const raw of (text || "").split(/\r?\n/)) {
    const line = raw.trim(), low = line.toLowerCase();
    if (low.startsWith("[events]")) break;   // Events 段（若有）不解析
    if (low.startsWith("playresx:")) {
      sheet.playRes = { x: +line.slice(9).trim() || 1920, y: sheet.playRes?.y || 1080 };
      continue;
    }
    if (low.startsWith("playresy:")) {
      sheet.playRes = { x: sheet.playRes?.x || 1920, y: +line.slice(9).trim() || 1080 };
      continue;
    }
    if (low.startsWith("format:")) { fmtKeys = low.slice(7).split(",").map(s => s.trim()); continue; }
    if (!low.startsWith("style:")) continue;
    const parts = line.slice(6).split(",").map(s => s.trim());
    const fields: StyleFields = {};
    fmtKeys.forEach((k, i) => { if (i < parts.length) fields[k] = parts[i]; });
    const name = fields.name || "";
    if (!name || sheet.fields[name]) continue;
    sheet.fields[name] = fields;
    sheet.order.push(name);
  }
  return sheet;
}

const num = (fields: StyleFields, key: string, fallback: number) =>
  +(fields[key] ?? FIELD_FALLBACK[key]) || fallback;

function toStyle(name: string, f: StyleFields): AssStyle {
  return {
    name,
    font: f.fontname ?? FIELD_FALLBACK.fontname,
    size: num(f, "fontsize", 70),
    c1: f.primarycolour ?? FIELD_FALLBACK.primarycolour,
    c3: f.outlinecolour ?? FIELD_FALLBACK.outlinecolour,
    c4: f.backcolour ?? FIELD_FALLBACK.backcolour,
    bold: num(f, "bold", 0), italic: num(f, "italic", 0),
    scx: num(f, "scalex", 100), scy: num(f, "scaley", 100), sp: num(f, "spacing", 0),
    outline: num(f, "outline", 0), shadow: num(f, "shadow", 0),
    align: num(f, "alignment", 2),
    ml: num(f, "marginl", 0), mr: num(f, "marginr", 0), mv: num(f, "marginv", 0),
  };
}

/** 按标准 23 字段顺序重新拼一行，Format 顺序被改过的外来样式也能原样落地 */
const styleLine = (name: string, f: StyleFields) =>
  "Style: " + ASS_FMT_DEFAULT.map(k => (k === "name" ? name : f[k] ?? FIELD_FALLBACK[k])).join(",");

/**
 * 装入本机样式表：写死的 JP/CN 打底，本机样式表接在后面；同名以本机那份为准，
 * 于是 JP/CN 永远存在（resolveStyle 的回退目标），但用户想重定义也拦得住。
 */
export function setStyleSheet(userText: string) {
  const user = parseSheet(userText);
  const builtin = parseSheet(BUILTIN_ASS_STYLES);
  styleMap = {};
  styleNames = [];
  const lines: string[] = [];
  for (const name of [...builtin.order, ...user.order]) {
    if (styleMap[name]) continue;
    const fields = user.fields[name] ?? builtin.fields[name];
    styleMap[name] = toStyle(name, fields);
    styleNames.push(name);
    lines.push(styleLine(name, fields));
  }
  playRes = user.playRes ?? { x: 1920, y: 1080 };
  stylesBlock = `[V4+ Styles]\n${ASS_STYLE_FORMAT}\n${lines.join("\n")}\n`;
}

/**
 * 把导入的 ASS 里的 [V4+ Styles] 并进现有样式表：同名覆盖、新名追加，原有的排在前面，
 * 全部按标准 Format 重排（导入的文件用什么字段顺序都不影响落地的这一份）。
 */
export function mergeStyleText(current: string, incoming: string) {
  const cur = parseSheet(current);
  const inc = parseSheet(incoming);
  const added: string[] = [];
  const updated: string[] = [];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const name of [...cur.order, ...inc.order]) {
    if (seen.has(name)) continue;
    seen.add(name);
    const from = inc.fields[name];
    if (from) (cur.fields[name] ? updated : added).push(name);
    lines.push(styleLine(name, from ?? cur.fields[name]));
  }
  // 重排会把 Style 行以外的东西丢掉，PlayRes 是其中唯一还起作用的，单独接回去
  const info = cur.playRes
    ? `[Script Info]\nPlayResX: ${cur.playRes.x}\nPlayResY: ${cur.playRes.y}\n\n`
    : "";
  const text = info + ["[V4+ Styles]", ASS_STYLE_FORMAT, ...lines, ""].join("\n");
  return { text, added, updated };
}

/** 样式表里没有的绑定回退到写死的 JP/CN——云端同步下来的文档常绑着本机没有的样式 */
export const resolveStyle = (name: string, lang: Lang): string =>
  styleMap[name] ? name : (lang === "ja" ? "JP" : "CN");

/** 预览与导出共用的 ASS 头：[Script Info] + 合并后的 [V4+ Styles] */
export const assHead = () =>
  "[Script Info]\nScriptType: v4.00+\n"
  + `PlayResX: ${playRes.x}\nPlayResY: ${playRes.y}\n`
  + "WrapStyle: 2\nScaledBorderAndShadow: yes\n\n" + stylesBlock;

/** 样式的主色，统一成 rgb() 形式（调用方要拆出 "r,g,b" 拼透明度） */
export function styleRgb(name: string | null, fallback: string): string {
  const st = name ? styleMap[name] : null;
  if (st) { const c = assColor(st.c1); return `rgb(${c.rgb.join(",")})`; }
  return fallback;
}

// ── 缺字检测 ──────────────────────────────────────────────
// 随包字体之外，样式表里引用的字体得靠系统装了同名的。
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
