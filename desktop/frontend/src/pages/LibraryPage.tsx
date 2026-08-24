import type { Dispatch, SetStateAction } from "react";
import type { CloudEntry } from "../bridge/cloud.ts";
import type { MediaEntry } from "../bridge/library.ts";
import { CloudMediaCard, LocalMediaCard } from "../components/MediaCard.tsx";
import type { ExecutionMode, LibraryFilter, LibraryItem, SortMode, ViewMode } from "../app/types.ts";
import "./LibraryPage.css";

interface LibraryPageProps {
  items: LibraryItem[];
  visibleItems: LibraryItem[];
  thumbnails: Record<string, string>;
  remoteByFingerprint: Map<string, CloudEntry>;
  filter: LibraryFilter;
  filterCounts: Record<LibraryFilter, number>;
  sort: SortMode;
  view: ViewMode;
  query: string;
  busy: boolean;
  message: string;
  localRunningID?: string;
  runningProgress: number;
  taskActive: boolean;
  executionMode: ExecutionMode;
  runtimeReady: boolean;
  cloudAuthenticated: boolean;
  syncing: boolean;
  setFilter: Dispatch<SetStateAction<LibraryFilter>>;
  setSort: Dispatch<SetStateAction<SortMode>>;
  setView: Dispatch<SetStateAction<ViewMode>>;
  onClearQuery: () => void;
  onImport: () => Promise<void>;
  onOpen: (entry: MediaEntry) => void;
  onStart: (entry: MediaEntry) => Promise<void>;
  onRename: (entry: MediaEntry) => void;
  onRemove: (entry: MediaEntry) => void;
  onDeleteCloud: (entry: CloudEntry) => void;
  onRelink: (entry: MediaEntry) => Promise<void>;
}

export function LibraryPage(props: LibraryPageProps) {
  const { items, visibleItems, thumbnails, remoteByFingerprint, filter, filterCounts, sort, view, query, busy, message, localRunningID, runningProgress, taskActive, executionMode, runtimeReady, cloudAuthenticated, syncing, setFilter, setSort, setView, onClearQuery, onImport, onOpen, onStart, onRename, onRemove, onDeleteCloud, onRelink } = props;
  return (
    <section className="library-view">
      <div className="library-toolbar">
        {([["all", "全部"], ["ready", "可编辑"], ["running", "处理中"], ["cloud", "仅云端"], ["missing", "文件丢失"]] as const).map(([value, label]) => (
          <button className={filter === value ? "active" : ""} key={value} onClick={() => setFilter(value)}>{label} <span>{filterCounts[value]}</span></button>
        ))}
        <span className="toolbar-spacer" />
        <select aria-label="媒体排序" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="recent">最近使用</option><option value="name">按标题</option><option value="duration">按时长</option></select>
        <div className="view-switch" aria-label="视图切换"><button className={view === "grid" ? "active" : ""} aria-label="网格视图" onClick={() => setView("grid")}>▦</button><button className={view === "list" ? "active" : ""} aria-label="列表视图" onClick={() => setView("list")}>☷</button></div>
      </div>
      {message && <p className="library-message">{message}</p>}
      {syncing ? (
        <div className="library-sync-state" role="status" aria-live="polite" aria-busy="true">
          <span className="library-sync-spinner" aria-hidden="true" />
          <strong>正在同步媒体库…</strong>
        </div>
      ) : items.length === 0 ? (
        <button className="empty-state library-empty" onClick={() => void onImport()} disabled={busy}><div className="empty-art"><span /><span /><span /></div><h3>把本地视频拖进来</h3><p>支持 MP4 / MOV / MKV / WebM。登录云端后，字幕记录会按媒体指纹自动合并到同一个媒体库。</p></button>
      ) : visibleItems.length === 0 ? (
        <div className="filtered-empty"><strong>没有匹配的媒体</strong><span>尝试清除搜索词或切换筛选条件。</span><button onClick={() => { onClearQuery(); setFilter("all"); }}>查看全部媒体</button></div>
      ) : (
        <div className={`media-grid ${view === "list" ? "list-view" : ""}`}>
          {visibleItems.map((item) => item.kind === "local" ? (
            <LocalMediaCard key={`local:${item.entry.id}`} entry={item.entry} thumbnail={thumbnails[item.entry.id]} running={item.entry.id === localRunningID} runningProgress={runningProgress} cloudEntry={remoteByFingerprint.get(item.entry.fingerprint)} canStart={item.entry.available && !taskActive && (executionMode === "local" ? runtimeReady : cloudAuthenticated)} executionMode={executionMode} onOpen={onOpen} onStart={onStart} onRename={onRename} onRemove={onRemove} onDeleteCloud={onDeleteCloud} onRelink={onRelink} />
          ) : <CloudMediaCard key={`cloud:${item.entry.id}`} entry={item.entry} onAssociate={onImport} onDelete={onDeleteCloud} />)}
        </div>
      )}
    </section>
  );
}
