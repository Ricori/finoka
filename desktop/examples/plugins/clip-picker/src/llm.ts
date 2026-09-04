// 大模型调用的接缝。
//
// 现在是 dummy：不联网，等 3 秒返回一段占位文本，好让上层的批次循环、进度、
// 取消、错误处理先写出来并跑通。等宿主支持了，**只改 callLLM 一个函数体**，
// 上层一行都不用动。
//
// 真接入长这样：
//
//     async function callLLM(system: string, user: string): Promise<string> {
//       const result = await rpc<{ text: string }>(
//         "llm.generate", { system, user }, 180_000);   // 模型慢，超时要放大
//       return result.text;
//     }
//
// 再往 nonoka-plugin.json 的 permissions 里加上对应权限。
//
// 为什么绕不开宿主：插件页跑在 sandbox iframe 里，CSP 是 connect-src 'none'，
// 页面发不出任何网络请求。所以在页面里放 API key 输入框是没有意义的 —— 填了
// 也调不通，而且宿主本来就管着密钥（设置页写到 /v1/settings/keys）。

/** 真接入后改成 false，界面上的「占位输出」提示会跟着消失。 */
const LLM_IS_STUB = true;

/** dummy 的假延迟。真调用是几十秒起步，这里短一点，够看清进度就行。 */
const STUB_DELAY_MS = 3_000;

/**
 * 调用大模型。
 *
 * @param system 角色/规则，对应 assets 里那两份 prompt
 * @param user   本次要处理的内容，比如某一批的字幕正文
 * @returns 模型的原始文本输出
 */
async function callLLM(system: string, user: string): Promise<string> {
  if (!LLM_IS_STUB) {
    const result = await rpc<{ text: string }>("llm.generate", { system, user }, 180_000);
    return result.text;
  }

  logLine(`callLLM（dummy）system ${system.length} 字 / user ${user.length} 字，等 ${STUB_DELAY_MS / 1000} 秒`);
  await delay(STUB_DELAY_MS);

  // 要 JSON 的那一步（to_excel）得回 JSON，否则解析和出表这两段永远跑不到。
  // 判据就看 system prompt 有没有要求只输出 JSON —— dummy 是开发用的替身，
  // 按调用方的要求给出**形状正确**的东西，内容仍然是占位。
  if (/只输出\s*JSON|纯\s*JSON/i.test(system)) return dummySheetJSON();

  return [
    "【这是 dummy callLLM 的占位输出，不是模型结果】",
    `收到 system ${system.length} 字、user ${user.length} 字。`,
    `system 首行：${firstLine(system)}`,
    `user 首行：${firstLine(user)}`,
  ].join("\n");
}

/** 形状照着 to_excel.md 的约定，内容是占位。 */
function dummySheetJSON(): string {
  const rows = [
    ["00:00:00", "00:12:30", "占位分类A", "dummy callLLM 的占位内容<br>• 第二个要点", "00:05:12 [占位] 【占位标题】<br>详情/理由：占位"],
    ["00:12:30", "00:41:05", "占位分类B", "dummy callLLM 的占位内容，接上真实模型后这里是本段的实际描述", ""],
    ["00:41:05", "01:03:44", "占位分类C", "dummy callLLM 的占位内容", "00:50:01 [占位] 【占位标题】"],
  ].map(([start, end, category, detail, highlight]) => ({
    start, end, category, detail, highlight, editor: "",
  }));
  return JSON.stringify({ sheet_date: "", rows }, null, 2);
}

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function firstLine(text: string): string {
  const line = text.split("\n").find((item) => item.trim().length > 0) ?? "";
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}
