// 阶段三：把模型返回的 JSON 解析成表，并拼出能直接粘进 Excel 的 TSV。
//
// 字段和形状由 assets/to_excel.md 规定：
//   { "sheet_date": "YYYYMMDD", "rows": [ {start,end,category,detail,highlight,editor} ] }
// 单元格内换行一律用 <br>，rows 按 start 升序。

const FIELDS = ["start", "end", "category", "detail", "highlight", "editor"] as const;
const HEADERS = ["开始", "结束", "分类", "详情", "高能切片", "剪辑"];

type Field = (typeof FIELDS)[number];
type Row = Record<Field, string>;

interface Sheet {
  date: string;
  rows: Row[];
}

/**
 * 从模型输出里挖出 JSON。
 *
 * 就算 prompt 写死「只输出 JSON」，模型也经常裹一层 ```json 围栏或者前后加句
 * 客套话，直接 JSON.parse 会炸。取第一个 { 到最后一个 } 之间的内容，比要求
 * 用户手动清理可靠得多。
 */
function extractJSON(raw: string): unknown {
  const text = raw.trim();
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open < 0 || close <= open) {
    throw new Error("模型没有返回 JSON 对象（检查它是不是没按要求只输出 JSON）");
  }
  return JSON.parse(text.slice(open, close + 1));
}

/**
 * 校验并整形。缺字段补空串而不是整份失败 —— 模型偶尔漏一个 editor，
 * 不该让整场直播的结果作废。
 */
function parseSummary(raw: string): Sheet {
  const data = extractJSON(raw) as { sheet_date?: unknown; rows?: unknown };
  if (!Array.isArray(data.rows)) throw new Error("JSON 里没有 rows 数组");
  if (data.rows.length === 0) throw new Error("rows 是空的");

  const rows = data.rows.map((item, index) => {
    if (item === null || typeof item !== "object") throw new Error(`第 ${index + 1} 行不是对象`);
    const source = item as Record<string, unknown>;
    const row = {} as Row;
    for (const key of FIELDS) row[key] = source[key] == null ? "" : String(source[key]);
    return row;
  });

  return { date: String(data.sheet_date ?? "").trim(), rows };
}

function renderTable(rows: Row[]): void {
  el("table-rows").replaceChildren(...rows.map((row) => {
    const tr = document.createElement("tr");
    for (const key of FIELDS) {
      const td = document.createElement("td");
      const numeric = key === "start" || key === "end";
      td.className = numeric ? "num" : "wrap";
      // 表里按 <br> 断行显示，跟贴进 Excel 之后看到的样子一致
      td.textContent = numeric ? row[key] : row[key].replace(/<br\s*\/?>/gi, "\n");
      tr.appendChild(td);
    }
    return tr;
  }));
}

/**
 * 一个单元格在 TSV 里长什么样。
 *
 * Excel 按制表符分列、按换行分行，所以单元格里的真实换行必须整格加引号
 * （内部引号翻倍），否则一行会被拆成好几行。不想要引号就把 <br> 原样留着，
 * 粘进去之后在 Excel 里查找替换。
 */
function excelCell(value: string, realNewline: boolean): string {
  const flat = value.replace(/\t/g, " ");
  if (!realNewline) return flat.replace(/[\r\n]+/g, " ").trim();

  const text = flat.replace(/<br\s*\/?>/gi, "\n").replace(/\r/g, "");
  if (text.includes("\n") || text.includes('"')) return `"${text.split('"').join('""')}"`;
  return text.trim();
}

function tableTSV(rows: Row[], realNewline: boolean): string {
  const body = rows.map((row) => FIELDS.map((key) => excelCell(row[key], realNewline)).join("\t"));
  return [HEADERS.join("\t"), ...body].join("\n");
}

/** 当前这张表。复制按钮从这里取。 */
let sheet: Sheet = { date: "", rows: [] };

function showSummary(raw: string): void {
  sheet = parseSummary(raw);
  renderTable(sheet.rows);
  el("result").hidden = false;

  const noTime = sheet.rows.filter((row) => !row.start || !row.end).length;
  const dateNote = sheet.date ? `　直播日期 ${sheet.date}` : "";
  el("result-head").textContent = `${sheet.rows.length} 行${dateNote}`;
  logLine(`解析出 ${sheet.rows.length} 行${noTime > 0 ? `，其中 ${noTime} 行缺时间` : ""}`);
}

/** 开新一轮时收起上一轮的表，免得旧结果和新日志同时挂在界面上。 */
function hideSummary(): void {
  sheet = { date: "", rows: [] };
  el("result").hidden = true;
}

function copyTable(): void {
  if (sheet.rows.length === 0) {
    say("还没有表格。", true);
    return;
  }
  const realNewline = el<HTMLInputElement>("real-newline").checked;
  void copyText(tableTSV(sheet.rows, realNewline), `已复制 ${sheet.rows.length} 行，去 Excel 里 Ctrl+V。`);
}
