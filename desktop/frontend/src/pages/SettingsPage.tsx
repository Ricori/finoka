import type { Dispatch, SetStateAction } from "react";
import type { FineSubSettingsState } from "../bridge/settings.ts";
import type { CacheStatus } from "../bridge/library.ts";
import type { RelocationProgress, StorageDestination, StorageStatus, StorageTarget } from "../bridge/storage.ts";
import { StorageLocationsCard } from "../components/StorageLocationsCard.tsx";
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
  storage: StorageStatus | null;
  storageProgress: RelocationProgress | null;
  storageBusy: boolean;
  storageMessage: string;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onSaveKey: (updates: Record<string, string | null>, name: string) => Promise<void>;
  onSaveCacheLimit: (limit: number) => Promise<void>;
  onClearCache: () => Promise<void>;
  onChooseStorage: (target: StorageTarget) => Promise<StorageDestination | null>;
  onRelocateStorage: (target: StorageTarget, destination: string) => Promise<void>;
  onResetStorage: (target: StorageTarget) => Promise<void>;
  onCancelStorage: () => Promise<void>;
  onDismissMessage: () => void;
  onDismissCacheMessage: () => void;
  onDismissStorageMessage: () => void;
}

export function SettingsPage(props: SettingsPageProps) {
  const {
    settings,
    drafts,
    busy,
    message,
    cache,
    cacheBusy,
    cacheMessage,
    storage,
    storageProgress,
    storageBusy,
    storageMessage,
    setDrafts,
    onSaveKey,
    onSaveCacheLimit,
    onClearCache,
    onChooseStorage,
    onRelocateStorage,
    onResetStorage,
    onCancelStorage,
    onDismissMessage,
    onDismissCacheMessage,
    onDismissStorageMessage,
  } = props;
  const keys = settings?.keys ?? [];
  const baseUrls = settings?.baseUrls ?? [];
  const modelRouting = settings?.modelRouting;
  // 模型提供商的 Key 归模型配置面板管，这里只留检索与下载凭据。
  const modelKeyNames = new Set((modelRouting?.providers ?? []).map((provider) => provider.keyName).filter(Boolean));
  const advancedKeys = keys.filter((key) => !modelKeyNames.has(key.name));
  return (
    <section className="keys-layout">
      <article className="panel keys-intro">
        <span className="eyebrow">LLM & service credentials</span>
        <h2>模型与服务密钥</h2>
        <p>先在下方选定提供商与全局模型，并为它填写 API Key。检索服务和下载凭据均为可选高级配置。</p>
      </article>

      <article className="cloud-key-note panel">
        <span aria-hidden="true">☁</span>
        <div><strong>使用云端服务时无需配置</strong><p>登录 Nonoka Cloud 后，模型与检索凭据由云端运行环境管理；以下 Key 仅用于本地处理。</p></div>
      </article>

      {modelRouting && <LlmConfigurationCard keys={keys} baseUrls={baseUrls} modelRouting={modelRouting} drafts={drafts} busy={busy} setDrafts={setDrafts} onSave={onSaveKey} />}

      {advancedKeys.length > 0 && <details className="advanced-keys panel"><summary><span><strong>高级配置</strong><small>联网检索与模型下载凭据</small></span><i>展开 {advancedKeys.length} 项</i></summary><div className="key-grid">{advancedKeys.map((key) => <KeyConfigurationCard key={key.name} item={key} value={drafts[key.name] ?? ""} busy={busy} setDrafts={setDrafts} onSave={onSaveKey} />)}</div></details>}

      <StorageLocationsCard
        status={storage}
        progress={storageProgress}
        busy={storageBusy}
        message={storageMessage}
        cache={cache}
        cacheBusy={cacheBusy}
        cacheMessage={cacheMessage}
        onChoose={onChooseStorage}
        onRelocate={onRelocateStorage}
        onReset={onResetStorage}
        onCancel={onCancelStorage}
        onSaveCacheLimit={onSaveCacheLimit}
        onClearCache={onClearCache}
        onDismissMessage={onDismissStorageMessage}
        onDismissCacheMessage={onDismissCacheMessage}
      />

      {!settings && <article className="panel unavailable-card"><strong>密钥服务尚未连接</strong><p>启动 Wails 桌面应用后可读取和保存 LLM 等密钥；浏览器预览不会接触本机密钥。</p></article>}
      <Notice className="keys-message" message={message} onDismiss={onDismissMessage} />
    </section>
  );
}
