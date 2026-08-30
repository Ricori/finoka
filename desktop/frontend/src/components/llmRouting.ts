import type { FineSubModelProvider, FineSubModelProviderID, FineSubModelRoute } from "../bridge/settings.ts";

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

/** 切换提供商后该填哪个模型。
 *
 * 手填模型 ID 的提供商（OpenAI/Anthropic 及两个兼容端点）没有可选清单，
 * 一律清空就意味着「切走再切回来」会把已经配好的模型 ID 弄丢。所以先用
 * 本次会话里为该提供商填过的值，再退回已保存的路由（保存过的那个提供商
 * 切回来时仍然有效），最后才是清单里的默认模型。
 */
export function pickModelForProvider(options: {
  provider: FineSubModelProvider | undefined;
  remembered?: string;
  savedModel?: string;
}): string {
  const { provider, remembered, savedModel } = options;
  if (!provider) return "";
  const candidate = (remembered ?? savedModel ?? "").trim();
  if (provider.mode === "select") {
    return provider.models.some((item) => item.id === candidate)
      ? candidate
      : (provider.defaultModel || provider.models[0]?.id || "");
  }
  return candidate;
}
