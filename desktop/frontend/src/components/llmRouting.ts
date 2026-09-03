import type { FineSubModelProvider, FineSubModelProviderID, FineSubModelRoute, FineSubModelRoutingState } from "../bridge/settings.ts";

export function routeSettingName(routeID: string, field: "provider" | "model") {
  return routeID === "default"
    ? `LLM_DEFAULT_${field.toUpperCase()}`
    : `LLM_ROUTE_${routeID.toUpperCase()}_${field.toUpperCase()}`;
}

export function hasDraft(drafts: Record<string, string>, name: string) {
  return Object.prototype.hasOwnProperty.call(drafts, name);
}

export function effectiveRoute(routeID: string, saved: FineSubModelRoute, drafts: Record<string, string>): FineSubModelRoute {
  const providerName = routeSettingName(routeID, "provider");
  const modelName = routeSettingName(routeID, "model");
  return {
    provider: (hasDraft(drafts, providerName) ? drafts[providerName] : saved.provider) as FineSubModelProviderID | "",
    model: hasDraft(drafts, modelName) ? drafts[modelName] : saved.model,
  };
}

export const MODEL_MEMORY_STORAGE_KEY = "finesub:llm-provider-models";

export function loadModelMemory(storage?: Pick<Storage, "getItem">): Record<string, Record<string, string>> {
  try {
    const backend = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    const raw = backend?.getItem(MODEL_MEMORY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveModelMemory(memory: Record<string, Record<string, string>>, storage?: Pick<Storage, "setItem">): void {
  try {
    const backend = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    backend?.setItem(MODEL_MEMORY_STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Ignore storage quota or environment errors
  }
}

/** 切换提供商后该填哪个模型。
 *
 * 手填模型 ID 的提供商（OpenAI/Anthropic 及两个兼容端点）没有可选清单，
 * 一律清空就意味着「切走再切回来」会把已经配好的模型 ID 弄丢。所以先用
 * 记住的值，再退回已保存的路由（保存过的那个提供商切回来时仍然有效），
 * 最后才是清单里的默认模型。
 *
 * 三个候选按「有值才算数」逐个降级，不能用 `??`：记忆里留下的空串同样是
 * 「没填」，一旦它把已保存的模型 ID 挡住，切回来就只剩空输入框，之后再切
 * 走又会把这个空串写回记忆，永远好不了。
 */
export function pickModelForProvider(options: {
  provider: FineSubModelProvider | undefined;
  remembered?: string;
  savedModel?: string;
}): string {
  const { provider, remembered, savedModel } = options;
  if (!provider) return "";
  const candidate = (remembered || savedModel || "").trim();
  if (provider.mode === "select") {
    return provider.models.some((item) => item.id === candidate)
      ? candidate
      : (provider.defaultModel || provider.models[0]?.id || "");
  }
  return candidate;
}

/** 音视频窗要求模型具备的能力位，与设置快照里的字段同名。 */
export type MediaCapability = "supportsAudio" | "supportsVideo";

/** 某个任务分组实际由哪个提供商与模型承担：任务级覆盖优先，否则用全局默认。 */
export function routeForTaskGroup(routing: FineSubModelRoutingState, routeID: string): FineSubModelRoute {
  const task = routing.taskRoutes.find((item) => item.id === routeID)?.route;
  return task && task.provider && task.model ? task : routing.defaultRoute;
}

/** 这一格能不能承担音频或视频窗。
 *
 * 本地 CLI 后面没有兜底——引擎侧选定本地 CLI 后就不再挂 API 梯队，所以只看
 * 它自己在打包清单里声明的能力。API 提供商后面仍然跟着打包的 Gemini 候选，
 * 因此手填模型（没有能力声明）或选中的模型本身不支持时，配了 Gemini Key 就
 * 仍然可行——由兜底承担。
 */
export function routeServesMedia(
  routing: FineSubModelRoutingState,
  routeID: string,
  capability: MediaCapability,
  geminiConfigured: boolean,
): boolean {
  const route = routeForTaskGroup(routing, routeID);
  if (!route.provider || !route.model) return false;
  const provider = routing.providers.find((item) => item.id === route.provider);
  if (!provider) return false;
  const declared = provider.models.find((item) => item.id === route.model)?.[capability] === true;
  return provider.requiresKey ? declared || geminiConfigured : declared;
}
