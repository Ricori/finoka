// 接线与启动。必须是 tsconfig 的 files 里最后一个：只有这里有顶层执行代码，
// 前面各文件都只做声明，所以拼接顺序不会踩到「用了还没初始化的东西」。

// 插件页是 iframe，切走就被宿主销毁 —— 流水线的循环跑在页面的 JS 里，进度和
// 已完成的批次都留不下来，宿主侧也没有通用存储能提前接住它们。只能提醒。
const RUNNING_NOTICE = "处理期间请不要切换页面：插件页会被销毁，进度和已经跑完的批次都会丢失。";
const DONE_NOTICE = "结果只存在这个页面里，切换页面就会丢 —— 先「复制为表格」存走。";

/**
 * 跑完整条流水线。返回 false 表示「正常地没跑出结果」（比如文档里没有句子），
 * 出错则抛出 —— 界面怎么收场由 start() 统一决定。
 */
async function runPipeline(media: MediaSummary): Promise<boolean> {
  clearLog();
  logLine(`开始：「${media.title}」（${clock(media.duration)}）`);
  say("正在读取字幕文档…");

  const document_ = await rpc<SubtitleDocument>("document.read", { mediaId: media.id });
  const lines = usableLines(document_);
  logLine(`读到字幕文档 rev ${document_.rev}，${lines.length} 句`);
  if (lines.length === 0) {
    say("这份文档里没有字幕句子。", true);
    logLine("没有可用的句子，停下");
    return false;
  }

  const batches = splitSubtitles(lines);
  const sizes = batches.map(coreCount);
  const spread = batches.length > 1 ? `每批 ${Math.min(...sizes)}–${Math.max(...sizes)} 行` : `${sizes[0]} 行`;
  logLine(`${lines.length} 句切成 ${batches.length} 批，${spread}`
    + `（上限 ${MAX_LINES} 行，前后各重叠 ${OVERLAP} 行）`);
  for (const batch of batches) {
    logLine(`  第 ${batch.no}/${batches.length} 批  ${batchRange(batch)}`
      + `  ${coreCount(batch)} 句（含重叠 ${batch.lines.length}）`);
  }

  const analyses = await runAnalysis(batches);
  showSummary(await runToExcel(joinAnalyses(batches, analyses)));

  const tail = LLM_IS_STUB ? "（dummy 内容，不是模型结果）" : "";
  say(`完成${tail}。点「复制为表格」，去 Excel 里 Ctrl+V。`);
  return true;
}

async function start(): Promise<void> {
  const media = selectedMedia();
  if (!media) {
    say("先选一份字幕档。", true);
    return;
  }
  // 没字幕的选项已经置灰，但键盘操作和列表刷新的时机差仍可能选中，所以再挡一次
  if (!media.documentAvailable) {
    say(`「${media.title}」还没有字幕文档，换一个。`, true);
    return;
  }

  const button = el<HTMLButtonElement>("start");
  button.disabled = true;
  hideSummary();
  notice(RUNNING_NOTICE, true);
  try {
    // 提醒条在这一处统一收场：跑通了换成「先复制走」，没跑出结果或出错就收起。
    // 散在各个分支里各写一遍的话，漏掉一处就会留一条过期的警告挂在界面上。
    notice(await runPipeline(media) ? DONE_NOTICE : null);
  } catch (error) {
    const detail = (error as Error).message;
    say(`失败：${detail}`, true);
    logLine(`失败：${detail}`);
    notice(null);
  } finally {
    button.disabled = false;
  }
}

el("start").addEventListener("click", () => void start());
el("reload").addEventListener("click", () => void loadMedia());
el("log-toggle").addEventListener("click", toggleLog);
el("copy").addEventListener("click", copyTable);

// 主动问一次主题。宿主在页面加载后也会自己推一次 host.info，但两边有竞态，
// 先问一下更稳。
window.nonoka.post("host.getInfo", {});

void loadMedia();
