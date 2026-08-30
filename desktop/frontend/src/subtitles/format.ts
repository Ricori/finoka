// ASS/SRT 字段编解码。纯函数，编辑器（src/editor/utils.ts 按原名再导出）和插件宿主共用。

const p2 = (n: number) => String(n).padStart(2, "0");

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

/** 秒 → SRT 时间码 HH:MM:SS,mmm */
export function srtTs(sec: number): string {
  let ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000); ms -= h * 3600000;
  const m = Math.floor(ms / 60000); ms -= m * 60000;
  const s = Math.floor(ms / 1000); ms -= s * 1000;
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(ms).padStart(3, "0")}`;
}
