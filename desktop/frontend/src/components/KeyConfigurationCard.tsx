import type { Dispatch, SetStateAction } from "react";
import type { FineSubKeyState } from "../bridge/settings.ts";
import { Mark } from "./Mark.tsx";
import "./KeyConfigurationCard.css";

interface KeyConfigurationCardProps {
  item: FineSubKeyState;
  value: string;
  busy: boolean;
  setDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  onSave: (updates: Record<string, string | null>, name: string) => Promise<void>;
}

export function KeyConfigurationCard({ item, value, busy, setDrafts, onSave }: KeyConfigurationCardProps) {
  return (
    <article className="panel key-card">
      <div className="key-card-heading">
        <div><h3>{item.label}</h3><code>{item.name}</code></div>
        <Mark>{item.configured ? `${item.count} 个已配置` : "未配置"}</Mark>
      </div>
      <p>{item.purpose}</p>
      <div className="key-current-value">
        <span>当前状态</span>
        <small>{item.masked.length > 0 ? item.masked.map((entry) => `${entry.name ? `${entry.name} · ` : ""}${entry.value}`).join("，") : "尚未保存 Key"}</small>
      </div>
      <label className="key-input-label">
        <span>{item.configured ? "替换 Key" : "API Key"}</span>
        <input aria-label={`${item.label} Key`} type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={item.configured ? "输入新值以替换" : "粘贴 API Key"} value={value} onChange={(event) => setDrafts((current) => ({ ...current, [item.name]: event.target.value }))} />
      </label>
      <div className="key-card-actions">
        {item.configured && <button className="danger-link" disabled={busy} onClick={() => void onSave({ [item.name]: null }, item.name)}>清除</button>}
        <button className="primary-button" disabled={busy || !value.trim()} onClick={() => void onSave({ [item.name]: value }, item.name)}>{busy ? "正在保存…" : "保存 Key"}</button>
      </div>
    </article>
  );
}
