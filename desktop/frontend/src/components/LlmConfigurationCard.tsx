import type { Dispatch, SetStateAction } from "react";
import type { FineSubBaseUrlState, FineSubKeyState, FineSubModelProviderID, FineSubModelRoute, FineSubModelRoutingState } from "../bridge/settings.ts";
import { Mark } from "./Mark.tsx";
import "./LlmConfigurationCard.css";

interface ProviderConfiguration {
  id: "gemini" | "gemini-paid" | "openai" | "anthropic";
  label: string;
  description: string;
  key?: FineSubKeyState;
  baseUrl?: FineSubBaseUrlState;
}

interface LlmConfigurationCardProps {
  providers: ProviderConfiguration[];
  modelRouting: FineSubModelRoutingState;
  drafts: Record<string, string>;
  busy: boolean;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onSave: (updates: Record<string, string | null>, name: string) => Promise<void>;
}

function hasDraft(drafts: Record<string, string>, name: string) {
  return Object.prototype.hasOwnProperty.call(drafts, name);
}

function routeSettingName(routeID: string, field: "provider" | "model") {
  return routeID === "default"
    ? `LLM_DEFAULT_${field.toUpperCase()}`
    : `LLM_ROUTE_${routeID.toUpperCase()}_${field.toUpperCase()}`;
}

function effectiveRoute(routeID: string, saved: FineSubModelRoute, drafts: Record<string, string>): FineSubModelRoute {
  const providerName = routeSettingName(routeID, "provider");
  const modelName = routeSettingName(routeID, "model");
  return {
    provider: (hasDraft(drafts, providerName) ? drafts[providerName] : saved.provider) as FineSubModelProviderID | "",
    model: hasDraft(drafts, modelName) ? drafts[modelName] : saved.model,
  };
}

export function LlmConfigurationCard({ providers, modelRouting, drafts, busy, setDrafts, onSave }: LlmConfigurationCardProps) {
  const configured = providers.filter((provider) => provider.key?.configured).length;
  const keyUpdates = Object.fromEntries(
    providers
      .flatMap((provider) => provider.key ? [[provider.key.name, drafts[provider.key.name]?.trim()]] : [])
      .filter(([, value]) => value),
  ) as Record<string, string>;
  const urlUpdates = Object.fromEntries(
    providers.flatMap((provider) => {
      const setting = provider.baseUrl;
      if (!setting || !hasDraft(drafts, setting.name)) return [];
      const value = drafts[setting.name].trim().replace(/\/+$/, "");
      return [[setting.name, !value || value === setting.defaultValue ? null : value]];
    }),
  ) as Record<string, string | null>;
  const routeUpdates = Object.fromEntries(
    [
      ["default", modelRouting.defaultRoute] as const,
      ...modelRouting.taskRoutes.map((item) => [item.id, item.route] as const),
    ].flatMap(([routeID]) => (["provider", "model"] as const).flatMap((field) => {
      const name = routeSettingName(routeID, field);
      return hasDraft(drafts, name) ? [[name, drafts[name].trim() || null]] : [];
    })),
  ) as Record<string, string | null>;
  const updates = { ...keyUpdates, ...urlUpdates, ...routeUpdates };

  const renderRoute = (routeID: string, saved: FineSubModelRoute, allowDefault: boolean) => {
    const route = effectiveRoute(routeID, saved, drafts);
    const provider = modelRouting.providers.find((item) => item.id === route.provider);
    const providerName = routeSettingName(routeID, "provider");
    const modelName = routeSettingName(routeID, "model");
    const setProvider = (nextProvider: string) => {
      const next = modelRouting.providers.find((item) => item.id === nextProvider);
      setDrafts((current) => ({
        ...current,
        [providerName]: nextProvider,
        [modelName]: next?.mode === "select" ? (next.models[0]?.id ?? "") : "",
      }));
    };
    return (
      <div className="llm-route-controls">
        <select aria-label={`${routeID} 提供商`} value={route.provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="">{allowDefault ? "跟随默认模型" : "内置自动路由"}</option>
          {modelRouting.providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {!provider ? (
          <input aria-label={`${routeID} 模型`} value="" disabled placeholder={allowDefault ? "使用默认模型" : "按任务自动选择"} />
        ) : provider.mode === "select" ? (
          <select aria-label={`${routeID} 模型`} value={route.model} onChange={(event) => setDrafts((current) => ({ ...current, [modelName]: event.target.value }))}>
            {provider.models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.id}</option>)}
          </select>
        ) : (
          <input aria-label={`${routeID} 模型 ID`} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={`填写 ${provider.label} 模型 ID`} value={route.model} onChange={(event) => setDrafts((current) => ({ ...current, [modelName]: event.target.value }))} />
        )}
      </div>
    );
  };

  return (
    <article className="panel llm-config-card">
      <div className="llm-config-heading">
        <div>
          <span className="eyebrow">Minimum configuration</span>
          <h2>模型 API Key</h2>
          <p>Gemini、OpenAI、Anthropic 任选一家配置即可；也可以同时配置多家。</p>
        </div>
        <Mark>{configured > 0 ? `已配置 ${configured} 项` : "任选一家"}</Mark>
      </div>

      <div className="llm-provider-list">
        {providers.map((provider) => {
          const item = provider.key;
          if (!item) return null;
          return (
            <div className="llm-provider-row" key={provider.id}>
              <div className="llm-provider-copy">
                <span className={`llm-provider-mark llm-provider-mark-${provider.id}`}>{provider.label.slice(0, 1)}</span>
                <div><strong>{provider.label}</strong><small>{provider.description}</small></div>
              </div>
              <div className="llm-key-status">
                <span>{item.configured ? `${item.count} 个已配置` : "未配置"}</span>
                <small>{item.masked.length > 0 ? item.masked.map((entry) => `${entry.name ? `${entry.name} · ` : ""}${entry.value}`).join("，") : item.name}</small>
              </div>
              <div className="llm-key-input">
                <input aria-label={`${provider.label} API Key`} type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={item.configured ? "输入新值以替换" : `粘贴 ${provider.label} API Key`} value={drafts[item.name] ?? ""} onChange={(event) => setDrafts((current) => ({ ...current, [item.name]: event.target.value }))} />
                {item.configured && <button className="danger-link" disabled={busy} onClick={() => void onSave({ [item.name]: null }, provider.label)}>清除</button>}
              </div>
            </div>
          );
        })}
      </div>

      <details className="llm-base-urls">
        <summary>
          <span><strong>自定义 Base URL</strong><small>默认使用各服务商的官方地址</small></span>
          <i>高级设置</i>
        </summary>
        <div className="llm-base-url-list">
          {providers.map((provider) => {
            const setting = provider.baseUrl;
            if (!setting) return null;
            const value = hasDraft(drafts, setting.name) ? drafts[setting.name] : (setting.value || setting.defaultValue);
            return (
              <label className="llm-base-url-row" key={setting.name}>
                <span><strong>{provider.label}</strong><small>{setting.customized ? "正在使用自定义地址" : "官方默认地址"}</small></span>
                <input aria-label={`${provider.label} Base URL`} type="url" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [setting.name]: event.target.value }))} />
                {setting.customized && <button type="button" className="danger-link" disabled={busy} onClick={() => void onSave({ [setting.name]: null }, `${provider.label} Base URL`)}>恢复默认</button>}
              </label>
            );
          })}
        </div>
      </details>

      <section className="llm-model-routing">
        <div className="llm-routing-heading">
          <span><strong>默认提供商与模型</strong><small>用于 LLM 纠错、规划、研究与知识处理</small></span>
        </div>
        <div className="llm-default-route">
          <span><strong>全局默认</strong><small>默认为 Gemini 自动路由</small></span>
          {renderRoute("default", modelRouting.defaultRoute, false)}
        </div>
        <details className="llm-task-routing">
          <summary><span><strong>自定义任务模型</strong><small>覆盖指定环节，其余跟随全局默认</small></span><i>配置 {modelRouting.taskRoutes.length} 个环节</i></summary>
          <div className="llm-task-route-list">
            {modelRouting.taskRoutes.map((item) => (
              <div className="llm-task-route-row" key={item.id}>
                <span><strong>{item.label}</strong><small>{item.id}</small></span>
                {renderRoute(item.id, item.route, true)}
              </div>
            ))}
          </div>
        </details>
      </section>

      <div className="llm-config-footer">
        <span>{configured > 0 ? "最小配置已完成" : "保存任意一家 API Key 即可启用本地模型能力"}</span>
        <button className="primary-button" disabled={busy || Object.keys(updates).length === 0} onClick={() => void onSave(updates, "模型配置")}>{busy ? "正在保存…" : "保存模型配置"}</button>
      </div>
    </article>
  );
}
