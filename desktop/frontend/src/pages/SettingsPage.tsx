import type { Dispatch, SetStateAction } from "react";
import type { FineSubSettingsState } from "../bridge/settings.ts";
import type { CacheStatus } from "../bridge/library.ts";
import { CacheSettingsCard } from "../components/CacheSettingsCard.tsx";
import { LlmConfigurationCard } from "../components/LlmConfigurationCard.tsx";
import { KeyConfigurationCard } from "../components/KeyConfigurationCard.tsx";
import "./SettingsPage.css";
import { Notice } from "../components/Notice.tsx";

interface SettingsPageProps {
  settings: FineSubSettingsState | null;
  drafts: Record<string, string>;
  busy: boolean;
  message: string;
  cache: CacheStatus | null;
  cacheBusy: boolean;
  cacheMessage: string;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onSaveKey: (updates: Record<string, string | null>, name: string) => Promise<void>;
  onSaveCacheLimit: (limit: number) => Promise<void>;
  onClearCache: () => Promise<void>;
  onDismissMessage: () => void;
  onDismissCacheMessage: () => void;
}

export function SettingsPage(props: SettingsPageProps) {
  const { settings, drafts, busy, message, cache, cacheBusy, cacheMessage, setDrafts, onSaveKey, onSaveCacheLimit, onClearCache, onDismissMessage, onDismissCacheMessage } = props;
  const keys = settings?.keys ?? [];
  const baseUrls = settings?.baseUrls ?? [];
  const minimumKeyNames = new Set(["GEMINI_FREE", "GEMINI_PAID", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
  const providers = [
    { id: "gemini" as const, label: "Gemini", description: "Google AI Studio 免费或付费项目", keyName: "GEMINI_FREE", baseUrlName: "GEMINI_BASE_URL" },
    { id: "gemini-paid" as const, label: "Gemini 付费池", description: "质量优先任务与更高用量配额", keyName: "GEMINI_PAID", baseUrlName: "" },
    { id: "openai" as const, label: "OpenAI", description: "GPT 系列模型与兼容服务", keyName: "OPENAI_API_KEY", baseUrlName: "OPENAI_BASE_URL" },
    { id: "anthropic" as const, label: "Anthropic", description: "Claude 系列模型与兼容服务", keyName: "ANTHROPIC_API_KEY", baseUrlName: "ANTHROPIC_BASE_URL" },
  ].map(({ keyName, baseUrlName, ...provider }) => ({ ...provider, key: keys.find((key) => key.name === keyName), baseUrl: baseUrls.find((item) => item.name === baseUrlName) }));
  const advancedKeys = keys.filter((key) => !minimumKeyNames.has(key.name));
  return (
    <section className="keys-layout">
      <article className="panel keys-intro">
        <span className="eyebrow">LLM & service credentials</span>
        <h2>模型与服务密钥</h2>
        <p>最低只需配置 Gemini、OpenAI 或 Anthropic 中任意一家的 API Key。检索服务和下载凭据均为可选高级配置。</p>
      </article>

      <article className="cloud-key-note panel">
        <span aria-hidden="true">☁</span>
        <div><strong>使用云端服务时无需配置</strong><p>登录 Nonoka Cloud 后，模型与检索凭据由云端运行环境管理；以下 Key 仅用于本地处理。</p></div>
      </article>

      {providers.some((provider) => provider.key) && settings?.modelRouting && <LlmConfigurationCard providers={providers} modelRouting={settings.modelRouting} drafts={drafts} busy={busy} setDrafts={setDrafts} onSave={onSaveKey} />}

      {advancedKeys.length > 0 && <details className="advanced-keys panel"><summary><span><strong>高级配置</strong><small>其他模型、联网检索与模型下载凭据</small></span><i>展开 {advancedKeys.length} 项</i></summary><div className="key-grid">{advancedKeys.map((key) => <KeyConfigurationCard key={key.name} item={key} value={drafts[key.name] ?? ""} busy={busy} setDrafts={setDrafts} onSave={onSaveKey} />)}</div></details>}

      <CacheSettingsCard status={cache} busy={cacheBusy} message={cacheMessage} onSaveLimit={onSaveCacheLimit} onClear={onClearCache} onDismissMessage={onDismissCacheMessage} />

      {!settings && <article className="panel unavailable-card"><strong>密钥服务尚未连接</strong><p>启动 Wails 桌面应用后可读取和保存 LLM 等密钥；浏览器预览不会接触本机密钥。</p></article>}
      <Notice className="keys-message" message={message} onDismiss={onDismissMessage} />
    </section>
  );
}
