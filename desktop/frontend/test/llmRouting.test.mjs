import assert from "node:assert/strict";
import test from "node:test";

import { choiceIdOf, effectiveRoute, loadModelMemory, pickModelForProvider, preferredMember, providerChoices, routeSettingName, routeServesMedia, saveModelMemory } from "../src/components/llmRouting.ts";

const compat = {
  id: "openai-compat",
  label: "OpenAI 兼容提供商",
  mode: "input",
  models: [],
  defaultModel: "",
  requiresKey: true,
  available: true,
  keyName: "OPENAI_COMPAT_API_KEY",
  baseUrlName: "OPENAI_COMPAT_BASE_URL",
  customEndpoint: true,
  keyConfigured: true,
  groupId: "",
  groupLabel: "",
  tierLabel: "",
};

const gemini = {
  ...compat,
  id: "gemini-free",
  label: "Gemini 免费池",
  mode: "select",
  models: [{ id: "gemini-3.7-flash", label: "Flash", supportsAudio: true, supportsVideo: true }, { id: "gemini-3.7-pro", label: "Pro", supportsAudio: true, supportsVideo: true }],
  defaultModel: "gemini-3.7-flash",
  keyName: "GEMINI_FREE",
  baseUrlName: "GEMINI_BASE_URL",
  customEndpoint: false,
  groupId: "gemini",
  groupLabel: "Gemini",
  tierLabel: "免费池",
};

const geminiPaid = {
  ...gemini,
  id: "gemini-paid",
  label: "Gemini 付费池",
  models: [{ id: "gemini-3.7-flash", label: "Flash", supportsAudio: true, supportsVideo: true }],
  keyName: "GEMINI_PAID",
  tierLabel: "付费池",
  keyConfigured: false,
};

test("route setting names", () => {
  assert.equal(routeSettingName("default", "model"), "LLM_DEFAULT_MODEL");
  assert.equal(routeSettingName("search_judge", "provider"), "LLM_ROUTE_SEARCH_JUDGE_PROVIDER");
});

test("drafts win over the saved route", () => {
  const saved = { provider: "openai-compat", model: "vendor/mini" };
  assert.deepEqual(effectiveRoute("default", saved, {}), saved);
  assert.deepEqual(effectiveRoute("default", saved, { LLM_DEFAULT_MODEL: "" }), { provider: "openai-compat", model: "" });
});

test("switching back to the saved compat provider restores its model ID", () => {
  assert.equal(pickModelForProvider({ provider: compat, savedModel: "vendor/mini" }), "vendor/mini");
});

test("a model typed this session outlives a round trip through another provider", () => {
  assert.equal(pickModelForProvider({ provider: compat, remembered: "vendor/typed", savedModel: "" }), "vendor/typed");
});

test("an empty remembered model never shadows the saved one", () => {
  // 离开一个还没填模型的兼容提供商会在记忆里留下空串。它一旦挡住已保存的
  // 模型 ID，切回来就是空输入框，再切走又把空串写回去，永远好不了。
  assert.equal(pickModelForProvider({ provider: compat, remembered: "", savedModel: "vendor/mini" }), "vendor/mini");
  assert.equal(pickModelForProvider({ provider: gemini, remembered: "", savedModel: "gemini-3.7-pro" }), "gemini-3.7-pro");
});

test("model memory persistence round-trips correctly", () => {
  const store = new Map();
  const mockStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, val) => { store.set(key, String(val)); },
  };
  assert.deepEqual(loadModelMemory(mockStorage), {});
  saveModelMemory({ default: { "openai-compat": "deepseek-chat" } }, mockStorage);
  assert.deepEqual(loadModelMemory(mockStorage), { default: { "openai-compat": "deepseek-chat" } });
});

test("model memory safely handles invalid or missing storage", () => {
  const mockStorage = {
    getItem: () => "invalid json {",
    setItem: () => {},
  };
  assert.deepEqual(loadModelMemory(mockStorage), {});
  assert.deepEqual(loadModelMemory(undefined), {});
});

test("an unconfigured compat provider still starts empty", () => {
  assert.equal(pickModelForProvider({ provider: compat }), "");
  assert.equal(pickModelForProvider({ provider: undefined, remembered: "vendor/mini" }), "");
});

test("catalog providers fall back to their default model", () => {
  assert.equal(pickModelForProvider({ provider: gemini }), "gemini-3.7-flash");
  assert.equal(pickModelForProvider({ provider: gemini, savedModel: "gemini-3.7-pro" }), "gemini-3.7-pro");
  // 清单里已经没有的模型不能留在选择框里，否则显示的和保存的会对不上。
  assert.equal(pickModelForProvider({ provider: gemini, remembered: "gemini-2.0-retired" }), "gemini-3.7-flash");
});

const agy = {
  ...compat,
  id: "local-agy",
  label: "本地 Antigravity",
  mode: "select",
  models: [
    { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash via agy", supportsAudio: true, supportsVideo: true },
    { id: "claude-opus-4-6-thinking", label: "Opus 4.6 via agy", supportsAudio: false, supportsVideo: false },
  ],
  defaultModel: "gemini-3.7-flash",
  requiresKey: false,
  keyName: "",
  baseUrlName: "",
  customEndpoint: false,
  keyConfigured: false,
};

const codex = {
  ...agy,
  id: "local-codex",
  label: "本地 Codex",
  models: [{ id: "gpt-5.6-terra", label: "GPT-5.6 Terra via Codex", supportsAudio: false, supportsVideo: false }],
  defaultModel: "gpt-5.6-terra",
};

function routing(defaultRoute, taskRoutes = {}) {
  return {
    providers: [compat, gemini, agy, codex],
    defaultRoute,
    taskRoutes: ["correction", "planning", "research", "search_judge", "knowledge"].map((id) => ({
      id,
      label: id,
      route: taskRoutes[id] ?? { provider: "", model: "" },
    })),
  };
}

test("a local CLI is judged on its own declared capabilities, with no Gemini key involved", () => {
  const state = routing({ provider: "local-agy", model: "gemini-3.7-flash" });
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", false), true);
  assert.equal(routeServesMedia(state, "correction", "supportsVideo", false), true);
});

test("a local CLI that declares no media stays unavailable even with a Gemini key", () => {
  // 引擎侧选定本地 CLI 后不再挂 API 梯队，所以这里没有兜底可言。
  const state = routing({ provider: "local-codex", model: "gpt-5.6-terra" });
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", true), false);
  const opus = routing({ provider: "local-agy", model: "claude-opus-4-6-thinking" });
  assert.equal(routeServesMedia(opus, "correction", "supportsAudio", true), false);
});

test("an API provider still rides on the packaged Gemini tail", () => {
  // 手填模型没有能力声明，引擎按纯文本登记；音视频窗由后面的打包候选承担。
  // 第四个参数是「配了付费 Key 吗」：免费池不承担音视频窗，那条尾巴也就跟着要
  // 付费池才算数。
  const state = routing({ provider: "openai-compat", model: "vendor/large" });
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", true), true);
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", false), false);
});

test("the task override decides its own cell, the global default the rest", () => {
  const state = routing(
    { provider: "local-codex", model: "gpt-5.6-terra" },
    { correction: { provider: "local-agy", model: "gemini-3.7-flash" } },
  );
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", false), true);
  // 每窗查询轮走这一格：没单独指定就落回全局默认的 codex，音频窗因此仍然不可行。
  assert.equal(routeServesMedia(state, "planning", "supportsAudio", false), false);
});

test("a half-filled override falls back to the global default", () => {
  const state = routing(
    { provider: "local-agy", model: "gemini-3.7-flash" },
    { correction: { provider: "local-codex", model: "" } },
  );
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", false), true);
});

test("an unset route serves nothing", () => {
  assert.equal(routeServesMedia(routing({ provider: "", model: "" }), "correction", "supportsAudio", true), false);
});

test("the Gemini free pool never takes a media window, whatever the model declares", () => {
  // 免费池按模型分别限流，而音视频窗要先把整段媒体传上 Files API 再让模型读一
  // 遍。能力位描述的是模型，挡住这条路的是它背后的配额，所以声明支持也不算数。
  const state = routing({ provider: "gemini-free", model: "gemini-3.7-flash" });
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", false), false);
  assert.equal(routeServesMedia(state, "correction", "supportsVideo", false), false);
});

test("a paid Gemini key reopens every media option", () => {
  const state = routing({ provider: "gemini-free", model: "gemini-3.7-flash" });
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", true), true);
  assert.equal(routeServesMedia(state, "correction", "supportsVideo", true), true);
});

test("a local CLI keeps its media windows with no Gemini key of any tier", () => {
  // 引擎侧选定本地 CLI 后不再挂 API 梯队，免费池那条限制与它无关：agy 的
  // Gemini 3.7 Flash 跑在用户自己的订阅上，不花任何 Gemini 配额。
  const state = routing({ provider: "local-agy", model: "gemini-3.7-flash" });
  assert.equal(routeServesMedia(state, "correction", "supportsAudio", false), true);
  assert.equal(routeServesMedia(state, "correction", "supportsVideo", false), true);
});

test("the two Gemini pools fold into one provider row", () => {
  const rows = providerChoices([compat, gemini, geminiPaid, agy]);
  assert.deepEqual(rows.map((item) => item.id), ["openai-compat", "gemini", "local-agy"]);
  assert.deepEqual(rows.map((item) => item.label), ["OpenAI 兼容提供商", "Gemini", "本地 Antigravity"]);
  // 组落在它第一个成员的位置，所以后端排的顺序就是用户看到的顺序。
  assert.deepEqual(rows[1].members.map((item) => item.id), ["gemini-free", "gemini-paid"]);
  assert.equal(rows[0].members.length, 1);
});

test("a provider maps back to the row it is shown in", () => {
  assert.equal(choiceIdOf(geminiPaid), "gemini");
  assert.equal(choiceIdOf(compat), "openai-compat");
  assert.equal(choiceIdOf(undefined), "");
});

test("picking the Gemini row keeps the tier already chosen", () => {
  // 切走再切回来不该把用户挑好的付费池换成免费池。
  const [row] = providerChoices([gemini, geminiPaid]);
  assert.equal(preferredMember(row, { current: "gemini-paid" }).id, "gemini-paid");
});

test("picking the Gemini row lands on the tier that has a key", () => {
  // 只配了付费池时，选中 Gemini 就该直接落到能用的那一档。
  const [row] = providerChoices([gemini, geminiPaid]);
  const usable = (provider) => provider.id === "gemini-paid";
  assert.equal(preferredMember(row, { usable }).id, "gemini-paid");
  // 一档都没配好时退回第一档，而不是什么都不选。
  assert.equal(preferredMember(row, { usable: () => false }).id, "gemini-free");
  assert.equal(preferredMember(row).id, "gemini-free");
});
