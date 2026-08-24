// 纯函数工具：时间码、数值钳制、ASS 字段编解码。无状态，可独立使用。

/** MM:SS.cc（厘秒） */
export function fmt(s: number): string {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), sec = Math.floor(s % 60), cs = Math.floor((s % 1) * 100);
  return String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") + "." + String(cs).padStart(2, "0");
}

export const round3 = (x: number) => Math.round(x * 1000) / 1000;

export const p2 = (n: number) => String(n).padStart(2, "0");

/** 切片详情里用时分秒：切片动辄几分钟，厘秒没意义 */
export const fmtHMS = (sec: number) => {
  const v = Math.max(0, Math.round(sec));
  return `${p2(Math.floor(v / 3600))}:${p2(Math.floor(v % 3600 / 60))}:${p2(v % 60)}`;
};

export const fmtDur = (sec: number) => {
  const v = Math.max(0, Math.round(sec));
  const h = Math.floor(v / 3600), m = Math.floor(v % 3600 / 60), s = v % 60;
  return (h ? h + "时" : "") + (h || m ? m + "分" : "") + s + "秒";
};

export const fmtMB = (n: number) => !n ? "—" : n >= 1024 ** 3
  ? (n / 1024 ** 3).toFixed(2) + " GB" : (n / 1024 ** 2).toFixed(0) + " MB";

export function clampN(v: unknown, lo: number, hi: number, d: number): number {
  return (typeof v === "number" && isFinite(v)) ? Math.min(Math.max(v, lo), hi) : d;
}

/** 主进程抛回来的错误可能带一层调用包装前缀，剥掉只留 Go 端写的那句话 */
export const errText = (e: any) => String(e?.message || e || "未知错误")
  .replace(/^Error invoking remote method '[^']*':\s*/, "")
  .replace(/^Error:\s*/, "");

// ── ASS 字段编解码 ────────────────────────────────────────────────
/** H:MM:SS.cc（厘秒；小时不补零） */
export function assTs(sec: number): string {
  let cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000); cs -= h * 360000;
  const m = Math.floor(cs / 6000); cs -= m * 6000;
  const s = Math.floor(cs / 100); cs -= s * 100;
  return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

/** assTs 的逆：H:MM:SS.cc → 秒 */
export const assSec = (s: string) => {
  const p = s.split(":");
  return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
};

/** 花括号会被当成覆写标签，换行转 \N */
export const assTx = (s: string) => (s || "").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N").trim();

/** Name（说话人）：逗号是 Dialogue 的字段分隔符，换行同样会截断行 */
export const assNm = (s: string) => (s || "").replace(/[,\r\n]/g, " ").trim();

/** ASS 颜色 &HAABBGGRR（AA 可省，00=不透明 FF=全透明）→ {css, rgb} */
export function assColor(c: string): { css: string; rgb: [number, number, number] } {
  const m = /&h([0-9a-f]{2})?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})\b/i.exec((c || "").trim());
  if (!m) return { css: "#ffffff", rgb: [255, 255, 255] };
  const a = m[1] ? (255 - parseInt(m[1], 16)) / 255 : 1;
  const b = parseInt(m[2], 16), g = parseInt(m[3], 16), r = parseInt(m[4], 16);
  return { css: a >= 0.999 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a.toFixed(3)})`, rgb: [r, g, b] };
}
