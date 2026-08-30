import assert from "node:assert/strict";
import test from "node:test";

import { effectiveRoute, pickModelForProvider, routeSettingName } from "../src/components/llmRouting.ts";

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
};

const gemini = {
  ...compat,
  id: "gemini-free",
  label: "Gemini",
  mode: "select",
  models: [{ id: "gemini-3.7-flash", label: "Flash", supportsAudio: true, supportsVideo: true }, { id: "gemini-3.7-pro", label: "Pro", supportsAudio: true, supportsVideo: true }],
  defaultModel: "gemini-3.7-flash",
  keyName: "GEMINI_FREE",
  baseUrlName: "GEMINI_BASE_URL",
  customEndpoint: false,
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
