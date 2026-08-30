// 编辑器里的各种阈值/上下限常量。数值与旧版逐个对齐，改动会直接改变手感。

export const MIN_DUR = 0.3;

// 时间轴缩放上下限（像素/秒）
export const ZOOM_FLOOR = 18;
export const ZOOM_MAX = 400;

// 波形显示增益：0 = 自动（按整条音轨峰值顶满）
export const WAVE_GAIN_MAX = 24;
export const WAVE_GAIN_STEPS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24];

// 行高上下限与默认值；隐藏轨压成 22px 标签行
export const ROW_MIN = 36;
export const ROW_MAX = 60;
export const SPECTRUM_ROW_H0 = 140;
export const WAVE_ROW_MAX = 240;
export const ROW_H0 = 48;
export const HIDDEN_H = 22;
/** 末轨之后留一段空，留出继续往下拖的余量 */
export const PAD_Y = 16;

// 标尺底部 22px 归时间刻度，切片标记一层层往上叠，每层 14px
export const RULER_BASE = 22;
export const CLIP_LANE_H = 14;
export const RULER_H0 = 26;

// 字幕块渲染
export const BLK_DETAIL_W = 12;   // 窄于此就不画手柄和文字
export const BLK_MARGIN = 1;      // 视口左右各多画一屏当缓冲
export const AGG_W = 7;           // 窄于此的连片块并成一条密度块
export const AGG_SPAN = 100;      // 单条密度块最多覆盖这么宽

// 列表虚拟化：上下各多渲染一屏
export const LIST_MARGIN = 1;

export const HISTORY_MAX = 60;
export const AUTOSAVE_MS = 5 * 60 * 1000;

// ── 擦洗音（scrub audio）────────────────
export const SCRUB_SYNC_MS = 50;     // 跟随（测速/纠偏）的间隔
export const SCRUB_TAIL_MS = 140;    // 停手/停止步进后多久收声
export const SCRUB_JUMP = 0.6;       // 差这么多秒以上算「跳了」，直接对位
export const SCRUB_BACK_TOL = 0.25;  // 往回拖时落后这么多就跳回光标处
export const SCRUB_K = 2.5;          // 位置误差纠偏系数
export const SCRUB_RATE_MIN = 0.8;
export const SCRUB_RATE_MAX = 4;
export const SCRUB_GRAIN_MS = 200;   // 一片至少放这么久
export const SCRUB_LEAD = 0.12;      // 允许 video 超前播放头这么多秒
export const SCRUB_CLICK_MS = 40;    // 点一下（没拖动）时响多久

/** 轨道 lane 的兜底主题色（未绑样式时用），统一 rgb() 形式便于拆出 "r,g,b" */
export const TRACK_PALETTE = [
  "rgb(217,140,179)", "rgb(201,168,107)", "rgb(143,125,224)",
  "rgb(111,191,90)", "rgb(91,192,217)", "rgb(224,151,91)",
];

// 与 vod/core/subtitles.py 的 _ASS_SCRIPT_INFO / _ASS_EVENTS_HEAD 保持一致
export const ASS_SCRIPT_INFO = "[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\n"
  + "PlayResY: 1080\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n";
export const ASS_EVENTS_HEAD = "\n[Events]\nFormat: Layer, Start, End, Style, Name,"
  + " MarginL, MarginR, MarginV, Effect, Text\n";

/** [V4+ Styles] 的标准 Format 行（23 字段）。本地样式表一律按它规范化输出 */
export const ASS_STYLE_FORMAT = "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour,"
  + " OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle,"
  + " BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding";

/**
 * 写死的两个默认样式。默认轨的原文/译文绑的就是它们，样式模板编辑器里不展示，
 * 也删不掉：文档绑到本机没有的样式时，回退的正是这两个（见 ass.ts::resolveStyle）。
 * 本地样式表里出现同名样式时以本地那份为准——「合并」而不是「锁死」。
 */
export const BUILTIN_ASS_STYLES = `Style: JP,方正准圆_GBK,70,&H00FFF9FD,&HF0000000,&H00EF9320,&H30633306,0,0,0,0,100,100,7,0,1,2,2,8,10,10,30,1
Style: CN,方正准圆_GBK,70,&H00FFF9FD,&HF0000000,&H00EF9320,&H30633306,0,0,0,0,100,100,7,0,1,2,2,2,10,10,30,1`;

/** 本机样式表还没存过时的种子：旧工程内置模板里除 JP/CN 之外的那几个样式 */
export const DEFAULT_USER_ASS_STYLES = `Style: 注释,思源黑体 Heavy,60,&H00FFFFFF,&H000000FF,&H00000000,&H00737375,0,0,0,0,100,100,0,0,1,2,2,7,30,30,30,1
Style: 优花,荆南波波黑,90,&H00D59B57,&H000000FF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,5,0,2,10,10,30,1
Style: haru,荆南波波黑,90,&H002E0C9B,&H000000FF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,5,0,2,10,10,30,1
Style: nana,荆南波波黑,90,&H00B9A7F0,&H000000FF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,5,0,2,10,10,30,1
Style: saya,荆南波波黑,90,&H0091DF82,&H000000FF,&H00FFFFFF,&H00000000,0,0,0,0,100,100,0,0,1,5,0,2,10,10,30,1`;

/** 本机样式表还没存过时写进编辑框的种子（不含写死的 JP/CN） */
export const DEFAULT_STYLE_SHEET = `[V4+ Styles]
${ASS_STYLE_FORMAT}
${DEFAULT_USER_ASS_STYLES}
`;

/** 旧工程 vod/core/subtitles.py 的全局默认样式；迁移来的文档没带模板时用它兜底。 */
export const DEFAULT_ASS_TEMPLATE = `[V4+ Styles]
${ASS_STYLE_FORMAT}
${BUILTIN_ASS_STYLES}
${DEFAULT_USER_ASS_STYLES}`;

/** Format 行缺省时的标准 23 字段 */
export const ASS_FMT_DEFAULT = ASS_STYLE_FORMAT.slice(7).toLowerCase().split(",").map(s => s.trim());

/** 随包自带的字体（导出时整个 fonts/ 都会喂给 ffmpeg），缺字检测里直接放行；比对不分大小写 */
export const BUNDLED_FONTS = ["方正准圆_gbk", "方正准圆", "FZ-ZhunYuan-GBK",
  "荆南波波黑", "JingNanBoBoHei"];

export const LAYOUT_KEY = "ytEditorLayout";

/** 横向滚动条高度：在轨道区底部预留同高沟槽，避免滚动条盖住最后一条轨道 */
export const SB = typeof document === "undefined" ? 0 : (() => {
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;top:-9999px;overflow-x:scroll;scrollbar-width:thin;width:100px;height:100px;";
  document.body.appendChild(d);
  const h = d.offsetHeight - d.clientHeight;
  d.remove();
  return h;
})();
