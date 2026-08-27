import { useEffect, useState } from "react";
import type { CacheStatus } from "../bridge/library.ts";
import "./CacheSettingsCard.css";
import { Notice } from "./Notice.tsx";

interface CacheSettingsCardProps {
  status: CacheStatus | null;
  busy: boolean;
  message: string;
  onSaveLimit: (limit: number) => Promise<void>;
  onClear: () => Promise<void>;
  onDismissMessage: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes >= 1024 ? 0 : 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function CacheSettingsCard({ status, busy, message, onSaveLimit, onClear, onDismissMessage }: CacheSettingsCardProps) {
  const [limit, setLimit] = useState("20");

  useEffect(() => {
    if (status) setLimit(String(status.limitGB));
  }, [status]);

  const value = Number(limit);
  const valid = Number.isFinite(value) && value >= 1 && value <= 1024;
  const usage = status?.limitBytes ? Math.min(100, status.bytes / status.limitBytes * 100) : 0;

  return (
    <article className="panel cache-settings-card">
      <div className="cache-settings-heading">
        <div>
          <span className="eyebrow">Managed video cache</span>
          <h2>视频库缓存</h2>
          <p>任务使用过的视频会复制到 Finoka 数据目录。达到上限后按最近使用时间自动回收；原始视频和字幕文档不会被删除。</p>
        </div>
        <strong>{status ? formatBytes(status.bytes) : "—"}</strong>
      </div>
      <div className="cache-meter" aria-label={`缓存使用率 ${usage.toFixed(0)}%`}><span style={{ width: `${usage}%` }} /></div>
      <div className="cache-stats">
        <span><b>{status?.files ?? 0}</b> 个视频副本</span>
        <span><b>{status ? formatBytes(status.limitBytes) : "—"}</b> 容量上限</span>
      </div>
      <div className="cache-directory" title={status?.directory}><span>存储位置</span><code>{status?.directory ?? "正在读取…"}</code></div>
      <div className="cache-settings-actions">
        <label>缓存上限（GB）<input type="number" min="1" max="1024" step="1" value={limit} onChange={(event) => setLimit(event.target.value)} /></label>
        <button disabled={busy || !valid || value === status?.limitGB} onClick={() => void onSaveLimit(value)}>保存上限</button>
        <button className="danger-link" disabled={busy || !status?.files} onClick={() => void onClear()}>清理视频缓存</button>
      </div>
      <Notice className="cache-settings-message" message={message} onDismiss={onDismissMessage} />
    </article>
  );
}
