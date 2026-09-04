// 进度日志。默认收起，点「日志」展开。
//
// 状态栏（say）只留一句话，说「现在怎么样」；日志留全过程，说「刚才发生了什么」。
// 切分和后面的逐批处理都是多步骤的，出问题时只有一行状态看不出卡在哪一步。

/** 留多少行。直播切出来的批次不多，但后面每批都会写几条，留够翻。 */
const LOG_LIMIT = 500;

const logLines: string[] = [];

function logLine(text: string): void {
  const stamp = new Date().toTimeString().slice(0, 8);
  logLines.push(`[${stamp}] ${text}`);
  if (logLines.length > LOG_LIMIT) logLines.splice(0, logLines.length - LOG_LIMIT);

  const box = el("log");
  box.textContent = logLines.join("\n");
  // 只有展开时滚动才有意义；收起状态下 scrollHeight 是 0，赋值无害
  box.scrollTop = box.scrollHeight;
}

function clearLog(): void {
  logLines.length = 0;
  el("log").textContent = "";
}

function toggleLog(): void {
  const box = el("log");
  box.hidden = !box.hidden;
  // 只切 class 不改 textContent —— 按钮里有个箭头 <span>，改文字会把它删掉
  el("log-toggle").classList.toggle("open", !box.hidden);
  if (!box.hidden) box.scrollTop = box.scrollHeight;
}
