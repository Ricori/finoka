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

/** 提供商下拉里的一行：一个提供商，或几个按 Key 档位细分的提供商。 */
export interface ProviderChoice {
  /** 选项值：分组用组 id，其余用提供商 id。两者不会相撞——组 id 由后端给。 */
  id: string;
  label: string;
  /** 组内档位，后端给的顺序；长度为 1 表示这一行没有档位可选。 */
  members: FineSubModelProvider[];
}

/** 把快照里的提供商折成下拉要显示的行。
 *
 * 组出现在它第一个成员的位置，所以后端排的顺序仍然是用户看到的顺序——
 * Gemini 两档折成一行以后，它上下的邻居不会变。
 */
export function providerChoices(providers: FineSubModelProvider[]): ProviderChoice[] {
  const choices: ProviderChoice[] = [];
  const grouped = new Map<string, ProviderChoice>();
  for (const provider of providers) {
    if (!provider.groupId) {
      choices.push({ id: provider.id, label: provider.label, members: [provider] });
      continue;
    }
    const existing = grouped.get(provider.groupId);
    if (existing) {
      existing.members.push(provider);
      continue;
    }
    const choice: ProviderChoice = {
      id: provider.groupId,
      label: provider.groupLabel || provider.label,
      members: [provider],
    };
    grouped.set(provider.groupId, choice);
    choices.push(choice);
  }
  return choices;
}

/** 某个提供商在下拉里对应哪一行。 */
export function choiceIdOf(provider: FineSubModelProvider | undefined): string {
  if (!provider) return "";
  return provider.groupId || provider.id;
}

/** 选中一行时启用哪个档位。
 *
 * 已经选中的档位优先留住：从 Gemini 切走再切回来，不该把用户挑好的付费池
 * 换成免费池。其次是配好凭据的那一档——只配了一个 Key 时，选中 Gemini 就该
 * 直接落到能用的那一档，而不是让用户再点一次。
 */
export function preferredMember(
  choice: ProviderChoice,
  options: { current?: string; usable?: (provider: FineSubModelProvider) => boolean } = {},
): FineSubModelProvider {
  const kept = choice.members.find((item) => item.id === options.current);
  if (kept) return kept;
  const usable = options.usable;
  return (usable && choice.members.find(usable)) || choice.members[0];
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
 * 因此手填模型（没有能力声明）或选中的模型本身不支持时，配了 Gemini 付费 Key
 * 就仍然可行——由兜底承担。
 *
 * 只认付费 Key，不认免费池。免费池按模型分别限流，音视频窗要先把整段媒体传上
 * Files API 再让模型读一遍，是所有窗型里最重也最容易被挡的一种：实测一次日语
 * 现场纠错，3.7-flash 与 3.6-flash 连着回 503 UNAVAILABLE、3.5-flash 读超时，
 * 一个窗都没跑完；换个时段重来只是把等待挪到文件上传上。把免费池能选的档位收
 * 到纯文本，是让它做它做得完的事，而不是让用户在几分钟的静默后自己去猜。
 */
export function routeServesMedia(
  routing: FineSubModelRoutingState,
  routeID: string,
  capability: MediaCapability,
  geminiPaidConfigured: boolean,
): boolean {
  const route = routeForTaskGroup(routing, routeID);
  if (!route.provider || !route.model) return false;
  // 显式指到免费池这一格时，声明的能力位也不算数：能力位描述的是模型，挡住这
  // 条路的是它背后的配额。配了付费 Key 才重新放行——那时兜底接得住。
  if (route.provider === "gemini-free" && !geminiPaidConfigured) return false;
  const provider = routing.providers.find((item) => item.id === route.provider);
  if (!provider) return false;
  const declared = provider.models.find((item) => item.id === route.model)?.[capability] === true;
  return provider.requiresKey ? declared || geminiPaidConfigured : declared;
}
