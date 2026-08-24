import { useEffect, useRef, useState } from "react";
import type { CloudEntry } from "../bridge/cloud.ts";
import { mediaLibrary } from "../bridge/library.ts";
import type { MediaEntry } from "../bridge/library.ts";
import { formatDate, formatDuration, formatSize } from "../app/format.ts";
import type { ExecutionMode } from "../app/types.ts";

interface LocalMediaCardProps {
  entry: MediaEntry;
  thumbnail?: string;
  running: boolean;
  runningProgress: number;
  cloudEntry?: CloudEntry;
  canStart: boolean;
  executionMode: ExecutionMode;
  onOpen: (entry: MediaEntry) => void;
  onStart: (entry: MediaEntry) => Promise<void>;
  onRename: (entry: MediaEntry) => void;
  onRemove: (entry: MediaEntry) => void;
  onDeleteCloud: (entry: CloudEntry) => void;
  onRelink: (entry: MediaEntry) => Promise<void>;
}

interface MenuAction {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

function CardMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`card-menu ${open ? "open" : ""}`} ref={root}>
      <button className="card-menu-trigger" type="button" aria-label="更多操作" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span /><span /><span />
      </button>
      {open && <div className="card-menu-popover" role="menu">
        {actions.map((action) => <button key={action.label} type="button" role="menuitem" className={action.danger ? "danger" : ""} disabled={action.disabled} onClick={() => { setOpen(false); action.onSelect(); }}>{action.label}</button>)}
      </div>}
    </div>
  );
}

export function LocalMediaCard(props: LocalMediaCardProps) {
  const { entry, thumbnail, running, runningProgress, cloudEntry, canStart, executionMode, onOpen, onStart, onRename, onRemove, onDeleteCloud, onRelink } = props;
  const menuActions: MenuAction[] = [
    { label: "重命名", onSelect: () => onRename(entry) },
    ...(entry.available ? [{ label: "在文件夹中显示", onSelect: () => void mediaLibrary.revealInFolder(entry.sourcePath) }] : []),
    { label: "从本地媒体库移除", danger: true, onSelect: () => onRemove(entry) },
    ...(cloudEntry ? [{ label: "删除云端字幕", danger: true, disabled: cloudEntry.status === "queued" || cloudEntry.status === "running", onSelect: () => onDeleteCloud(cloudEntry) }] : []),
  ];
  return (
    <article className={`media-card local-card ${!entry.available ? "missing-media" : ""}`}>
      <div className="media-thumb">
        {thumbnail ? <img src={thumbnail} alt="" /> : <span className="media-placeholder">▶</span>}
        <small className="duration-badge">{formatDuration(entry.duration)}</small>
        <strong className={`state-badge ${running ? "running" : !entry.available ? "missing" : entry.documentAvailable ? "ready" : "idle"}`}>{running ? "处理中" : !entry.available ? "文件丢失" : entry.documentAvailable ? "字幕可编辑" : "等待处理"}</strong>
        {running && <span className="card-progress" style={{ width: `${runningProgress}%` }} />}
      </div>
      <div className="media-card-copy">
        <div className="media-title-row">
          <strong title={entry.sourcePath}>{entry.title}</strong>
          <CardMenu actions={menuActions} />
        </div>
        <span className="media-meta">{entry.width}×{entry.height} · {formatSize(entry.size)} · {formatDate(entry.lastAccess || entry.addedAt)}</span>
        <div className="media-chips"><small>{entry.available ? "本机文件" : "源文件离线"}</small>{cloudEntry && <small className="cloud-badge">☁ 字幕已同步</small>}</div>
        <div className="media-card-actions">
          {entry.documentAvailable && <button className="primary-card-action" onClick={() => onOpen(entry)}>继续编辑</button>}
          {!entry.available ? (
            <button className="primary-card-action" onClick={() => void onRelink(entry)}>重新定位</button>
          ) : (
            <button className={entry.documentAvailable ? "secondary-card-action" : "primary-card-action"} disabled={!canStart} onClick={() => void onStart(entry)}>{running ? "处理中…" : executionMode === "cloud" ? "云端转写" : entry.documentAvailable ? "重新转写" : "开始转写"}</button>
          )}
        </div>
      </div>
    </article>
  );
}

export function CloudMediaCard({ entry, onAssociate, onDelete }: { entry: CloudEntry; onAssociate: () => Promise<void>; onDelete: (entry: CloudEntry) => void }) {
  return (
    <article className="media-card cloud-card">
      <div className="media-thumb cloud-thumb"><span>☁</span><small className="duration-badge">{formatDuration(entry.duration)}</small><strong className="state-badge cloud">仅云端字幕</strong></div>
      <div className="media-card-copy">
        <div className="media-title-row"><strong title={entry.title}>{entry.title}</strong><CardMenu actions={[{ label: "删除云端字幕", danger: true, disabled: entry.status === "queued" || entry.status === "running", onSelect: () => onDelete(entry) }]} /></div>
        <span className="media-meta">{entry.status} · {formatDate(entry.updatedAt)}</span>
        <div className="media-chips"><small className="cloud-badge">{entry.source === "local_sync" ? "由本机自动同步" : "云端容器任务"}</small>{entry.ownerName && <small className="cloud-badge">{entry.ownerName}</small>}</div>
        <div className="media-card-actions"><button className="primary-card-action" onClick={() => void onAssociate()}>关联本地视频</button></div>
      </div>
    </article>
  );
}
