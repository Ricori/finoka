import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import type { Snapshot as SidecarSnapshot } from "../../bindings/github.com/Ricori/finoka/desktop/internal/sidecar/models.js";
import { mediaLibrary } from "../bridge/library.ts";
import type { CacheStatus, ImportResult, MediaEntry } from "../bridge/library.ts";
import { cloudAccount, DEFAULT_CLOUD_BACKEND } from "../bridge/cloud.ts";
import type { CloudEntry, CloudSession } from "../bridge/cloud.ts";
import { fineSubSettings } from "../bridge/settings.ts";
import type { FineSubSettingsState } from "../bridge/settings.ts";
import { fineSubRuntime } from "../bridge/runtime.ts";
import type { RuntimeProvisionState } from "../bridge/runtime.ts";
import { desktopPreferences } from "../bridge/preferences.ts";
import { desktopWindows } from "../bridge/windows.ts";
import { localProviderBridge, sidecarStatus } from "../bridge/wails.ts";
import { PipelineController } from "../home/pipelineController.ts";
import { CloudExecutionProvider } from "../providers/cloudProvider.ts";
import type { PipelineState } from "../home/pipelineController.ts";
import { LocalExecutionProvider } from "../providers/localProvider.ts";
import type { Capabilities, TaskRequest, TaskSnapshot } from "../providers/types.ts";
import { MediaDialog } from "../components/MediaDialog.tsx";
import { TranscriptionDialog } from "../components/TranscriptionDialog.tsx";
import { WindowDropOverlay } from "../components/WindowDropOverlay.tsx";
import { AccountPage } from "../pages/AccountPage.tsx";
import { AdminKeysPage } from "../pages/AdminKeysPage.tsx";
import { RuntimePage } from "../pages/RuntimePage.tsx";
import { SettingsPage } from "../pages/SettingsPage.tsx";
import { TasksPage } from "../pages/TasksPage.tsx";
import { LibraryPage } from "../pages/LibraryPage.tsx";
import { parseTaskHistory } from "./format.ts";
import { applyTheme, initialTheme } from "./theme.ts";
import type { DialogState, ExecutionMode, LibraryFilter, LibraryItem, LoadState, NavigationSection, Section, SortMode, TaskHistoryEntry, Theme, ViewMode } from "./types.ts";
import { activeStates, taskHistoryLimit } from "./types.ts";

const taskPollIntervalMs = 10_000;

function NavIcon({ kind }: { kind: NavigationSection }) {
  const paths = {
    library: "M4 6.5h16M6 3h12a2 2 0 0 1 2 2v14H4V5a2 2 0 0 1 2-2Zm3 7h6m-6 4h4",
    tasks: "M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5",
    runtime: "M4 5h16v14H4zM8 9h3m2 0h3m-8 4h8m-8 3h5",
    adminKeys: "M8.5 14.5 14 9m-1.5-2.5a3.5 3.5 0 1 1 5 5l-1 1-2-2-2 2-2-2-2 2-2.5-2.5 1-1Z",
    settings:
      "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m15-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m13 0-1.4-1.4M6.9 6.9 5.5 5.5",
  } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  );
}

export default function App() {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("local");
  const localProvider = useMemo(() => new LocalExecutionProvider(localProviderBridge), []);
  const cloudProvider = useMemo(() => new CloudExecutionProvider(cloudAccount), []);
  const localController = useMemo(() => new PipelineController(localProvider), [localProvider]);
  const cloudController = useMemo(() => new PipelineController(cloudProvider), [cloudProvider]);
  const controller = executionMode === "local" ? localController : cloudController;
  const [section, setSection] = useState<Section>("library");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [sidecar, setSidecar] = useState<SidecarSnapshot | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [message, setMessage] = useState("");
  const [media, setMedia] = useState<MediaEntry[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMessage, setCacheMessage] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>(controller.current() as PipelineState);
  const [taskHistory, setTaskHistory] = useState<TaskHistoryEntry[]>([]);
  const [taskHistoryBusy, setTaskHistoryBusy] = useState(false);
  const [taskHistoryMessage, setTaskHistoryMessage] = useState("");
  const [settings, setSettings] = useState<FineSubSettingsState | null>(null);
  const [runtimeProvision, setRuntimeProvision] = useState<RuntimeProvisionState | null>(null);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [keysBusy, setKeysBusy] = useState(false);
  const [keysMessage, setKeysMessage] = useState("");
  const [cloudSession, setCloudSession] = useState<CloudSession | null>(null);
  const [cloudMedia, setCloudMedia] = useState<CloudEntry[]>([]);
  const [cloudCapabilities, setCloudCapabilities] = useState<Capabilities | null>(null);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [loginKey, setLoginKey] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [activeMedia, setActiveMedia] = useState<MediaEntry | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [transcriptionMedia, setTranscriptionMedia] = useState<MediaEntry | null>(null);
  const [transcriptionBusy, setTranscriptionBusy] = useState(false);
  const [transcriptionError, setTranscriptionError] = useState("");
  const syncedTasks = useRef(new Set<string>());
  const openedTasks = useRef(new Set<string>());
  const taskHistoryHydrated = useRef(false);
  const preferencesHydrated = useRef(false);
  const taskHistoryRef = useRef(taskHistory);

  useEffect(() => {
    taskHistoryRef.current = taskHistory;
    if (preferencesHydrated.current) void desktopPreferences.save({ taskHistory: taskHistory.slice(0, taskHistoryLimit) }).catch(() => undefined);
  }, [taskHistory]);

  useEffect(() => {
    if (taskHistoryMessage !== "任务列表已清空。" && !taskHistoryMessage.startsWith("已清除 ")) return;
    const timer = window.setTimeout(() => {
      setTaskHistoryMessage((current) => current === taskHistoryMessage ? "" : current);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [taskHistoryMessage]);

  useEffect(() => {
    void desktopPreferences.get().then((value) => {
      setTheme(value.homeTheme === "dark" ? "dark" : "light");
      setSidebarCollapsed(value.sidebarCollapsed);
      setViewMode(value.libraryView === "list" ? "list" : "grid");
      setTaskHistory(parseTaskHistory(value.taskHistory));
    }).catch(() => undefined).finally(() => {
      preferencesHydrated.current = true;
    });
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (preferencesHydrated.current) void desktopPreferences.save({ homeTheme: theme }).catch(() => undefined);
  }, [theme]);

  useEffect(() => {
    if (preferencesHydrated.current) void desktopPreferences.save({ sidebarCollapsed }).catch(() => undefined);
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (preferencesHydrated.current) void desktopPreferences.save({ libraryView: viewMode }).catch(() => undefined);
  }, [viewMode]);

  const refresh = useCallback(async () => {
    setLoadState("loading");
    setMessage("");
    try {
      const status = await sidecarStatus();
      setSidecar(status);
      if (!status.running) {
        setCapabilities(null);
        setMessage(status.error || "本地执行服务尚未启动");
        setLoadState("error");
        return;
      }
      const [nextCapabilities, nextSettings, nextRuntimeProvision] = await Promise.all([
        localProvider.capabilities(),
        fineSubSettings.read(),
        fineSubRuntime.status(),
      ]);
      setCapabilities(nextCapabilities);
      setSettings(nextSettings);
      setRuntimeProvision(nextRuntimeProvision);
      setLoadState("ready");
    } catch (value) {
      setLoadState("error");
      const detail = value instanceof Error ? value.message : String(value ?? "");
      setMessage(detail || "无法连接 Wails 桌面桥接");
    }
  }, [localProvider]);

  const hydrateThumbnails = useCallback(async (entries: MediaEntry[]) => {
    const pairs = await Promise.all(
      entries
        .filter((entry) => entry.thumbnailAvailable)
        .map(async (entry) => {
          try {
            return [entry.id, await mediaLibrary.thumbnail(entry.id)] as const;
          } catch {
            return null;
          }
        }),
    );
    setThumbnails(Object.fromEntries(pairs.filter((pair) => pair !== null)));
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const entries = await mediaLibrary.list();
      setMedia(entries);
      await hydrateThumbnails(entries);
    } catch (value) {
      const detail = value instanceof Error ? value.message : String(value ?? "");
      setLibraryMessage(detail || "无法连接本地媒体库");
    }
  }, [hydrateThumbnails]);

  const openEditor = useCallback(async (entry: MediaEntry) => {
    setLibraryMessage("");
    try {
      await desktopWindows.openEditor(entry.id);
    } catch (value) {
      setLibraryMessage(value instanceof Error ? value.message : String(value));
    }
  }, []);

  const loadCacheStatus = useCallback(async () => {
    try {
      setCacheStatus(await mediaLibrary.cacheStatus());
    } catch {
      setCacheStatus(null);
    }
  }, []);

  const loadCloud = useCallback(async () => {
    setCloudLoading(true);
    try {
      const cached = await cloudAccount.session();
      const session = cached.authenticated ? await cloudAccount.refreshSession() : cached;
      setCloudSession(session);
      if (!session.authenticated) {
        setCloudMedia([]);
        setCloudCapabilities(null);
        return;
      }
      setCloudMedia(await cloudAccount.library());
      setCloudCapabilities(await cloudProvider.capabilities().catch(() => null));
      if (session.synced || session.syncFailed || session.syncError) {
        setAccountMessage(
          session.syncError
            ? `已登录，但自动同步检查失败：${session.syncError}`
            : `已补同步 ${session.synced ?? 0} 个本地字幕${session.syncFailed ? `，${session.syncFailed} 个失败` : ""}。`,
        );
      }
    } catch (value) {
      setCloudSession({ authenticated: false, running: 0 });
      setCloudMedia([]);
      setCloudCapabilities(null);
      const detail = value instanceof Error ? value.message : String(value ?? "");
      if (detail && !detail.includes("Wails")) setAccountMessage(detail);
    } finally {
      setCloudLoading(false);
    }
  }, [cloudProvider]);

  const acceptImport = useCallback(async (result: ImportResult) => {
    const failures = result.failed ?? [];
    if (failures.length > 0) {
      setLibraryMessage(failures.map((failure) => `${failure.name}: ${failure.message}`).join("；"));
    } else if ((result.added ?? []).length > 0) {
      setLibraryMessage(`已导入 ${(result.added ?? []).length} 个本地媒体`);
    }
    await loadLibrary();
  }, [loadLibrary]);

  const mediaDependencyMissing = capabilities?.runtime?.stages
    ?.find((stage) => stage.id === "media")
    ?.issues.some((issue) => issue.code === "missing_ffmpeg") === true;

  const importMedia = useCallback(async (paths?: string[]) => {
    if (mediaDependencyMissing) {
      setSection("runtime");
      setMessage("导入视频需要 FFmpeg 与 FFprobe，正在准备下载到 Finoka 缓存目录。");
      if (runtimeProvision?.media_supported && runtimeProvision.job.state !== "running") {
        try {
          setRuntimeProvision(await fineSubRuntime.install("media"));
        } catch (value) {
          setMessage(value instanceof Error ? value.message : String(value));
        }
      }
      return;
    }
    setLibraryBusy(true);
    setLibraryMessage("");
    try {
      const result = paths ? await mediaLibrary.importPaths(paths) : await mediaLibrary.pickAndImport();
      await acceptImport(result);
    } catch (value) {
      const detail = value instanceof Error ? value.message : String(value ?? "");
      setLibraryMessage(detail || "媒体导入失败");
    } finally {
      setLibraryBusy(false);
    }
  }, [acceptImport, mediaDependencyMissing, runtimeProvision]);

  useEffect(() => {
    void Promise.all([refresh(), loadLibrary(), loadCloud(), loadCacheStatus()]);
  }, [loadCacheStatus, loadCloud, loadLibrary, refresh]);

  useEffect(() => controller.subscribe((state) => setPipeline({ ...state })), [controller]);

  useEffect(() => {
    if (runtimeProvision?.job.state !== "running") return;
    const timer = window.setInterval(() => {
      void fineSubRuntime.status().then((status) => {
        setRuntimeProvision(status);
        if (status.job.state === "completed") void refresh();
      }).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [refresh, runtimeProvision?.job.state]);

  useEffect(() => {
    if (!pipeline.snapshot || !activeStates.has(pipeline.snapshot.state)) return;
    const timer = window.setInterval(() => void controller.refresh(), taskPollIntervalMs);
    return () => window.clearInterval(timer);
  }, [controller, pipeline.snapshot]);

  useEffect(() => {
    const offChanged = Events.On("library:changed", (event) => {
      const entries = Array.isArray(event.data) ? (event.data as MediaEntry[]) : [];
      setMedia(entries);
      void hydrateThumbnails(entries);
    });
    return () => {
      offChanged();
    };
  }, [hydrateThumbnails]);

  useEffect(() => Events.On("home:refresh", () => {
    void loadLibrary();
    void desktopPreferences.get().then((value) => {
      setTheme(value.homeTheme === "dark" ? "dark" : "light");
    }).catch(() => undefined);
  }), [loadLibrary]);

  const handleDroppedFiles = useCallback((paths: string[], ignored: number) => {
    setSection("library");
    const warning = ignored > 0 ? `已忽略 ${ignored} 个非视频文件；支持 MP4 / M4V / MOV / MKV / WebM。` : "";
    if (paths.length > 0) {
      void importMedia(paths).then(() => {
        if (warning) setLibraryMessage((current) => current ? `${current}；${warning}` : warning);
      });
    } else if (warning) {
      setLibraryMessage(warning);
    }
  }, [importMedia]);

  const rememberTask = useCallback((snapshot: TaskSnapshot, entry: MediaEntry) => {
    setTaskHistory((current) => [{
      taskId: snapshot.task_id,
      provider: snapshot.provider,
      mediaId: entry.id,
      title: entry.title,
      snapshot,
    }, ...current.filter((item) => item.taskId !== snapshot.task_id)].slice(0, taskHistoryLimit));
  }, []);

  const refreshTaskHistory = useCallback(async () => {
    setTaskHistoryBusy(true);
    setTaskHistoryMessage("");
    try {
      const current = taskHistoryRef.current;
      const refreshed = await Promise.all(current.map(async (item) => {
        if (item.provider === "cloud" && !cloudSession?.authenticated) return item;
        try {
          const taskProvider = item.provider === "local" ? localProvider : cloudProvider;
          return { ...item, snapshot: await taskProvider.status(item.taskId) };
        } catch {
          return item;
        }
      }));
      const listings = await Promise.allSettled([
        localProvider.listTasks(),
        cloudSession?.authenticated ? cloudProvider.listTasks() : Promise.resolve([]),
      ]);
      const byTask = new Map(refreshed.map((item) => [item.taskId, item]));
      for (const listing of listings) {
        if (listing.status !== "fulfilled") continue;
        for (const item of listing.value) {
          const existing = byTask.get(item.snapshot.task_id);
          byTask.set(item.snapshot.task_id, {
            taskId: item.snapshot.task_id,
            provider: item.snapshot.provider,
            mediaId: item.media_id || existing?.mediaId || "",
            title: item.title || existing?.title || item.snapshot.task_id,
            snapshot: item.snapshot,
          });
        }
      }
      setTaskHistory([...byTask.values()]
        .sort((left, right) => Date.parse(right.snapshot.updated_at) - Date.parse(left.snapshot.updated_at))
        .slice(0, taskHistoryLimit));
    } catch (value) {
      setTaskHistoryMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setTaskHistoryBusy(false);
    }
  }, [cloudProvider, cloudSession?.authenticated, localProvider]);

  const refreshActiveTaskHistory = useCallback(async () => {
    const active = taskHistoryRef.current.filter((item) => activeStates.has(item.snapshot.state));
    if (active.length === 0) return;
    const updates = await Promise.all(active.map(async (item) => {
      if (item.provider === "cloud" && !cloudSession?.authenticated) return null;
      try {
        const taskProvider = item.provider === "local" ? localProvider : cloudProvider;
        return await taskProvider.status(item.taskId);
      } catch {
        return null;
      }
    }));
    if (!updates.some((snapshot) => snapshot !== null)) return;
    const byTask = new Map(active.map((item, index) => [item.taskId, updates[index]]));
    setTaskHistory((current) => current.map((item) => {
      const snapshot = byTask.get(item.taskId);
      return snapshot ? { ...item, snapshot } : item;
    }));
  }, [cloudProvider, cloudSession?.authenticated, localProvider]);

  useEffect(() => {
    if (taskHistoryHydrated.current || loadState === "loading" || taskHistory.length === 0) return;
    taskHistoryHydrated.current = true;
    void refreshTaskHistory();
  }, [loadState, refreshTaskHistory, taskHistory.length]);

  const hasActiveHistory = taskHistory.some((item) => activeStates.has(item.snapshot.state));
  useEffect(() => {
    if (!hasActiveHistory) return;
    void refreshActiveTaskHistory();
    const timer = window.setInterval(
      () => void refreshActiveTaskHistory(),
      taskPollIntervalMs,
    );
    return () => window.clearInterval(timer);
  }, [hasActiveHistory, refreshActiveTaskHistory]);

  const actOnHistoryTask = useCallback(async (item: TaskHistoryEntry, action: "cancel" | "resume") => {
    const taskProvider = item.provider === "local" ? localProvider : cloudProvider;
    setTaskHistoryMessage("");
    try {
      const isCurrent = pipeline.snapshot?.task_id === item.taskId;
      const snapshot = isCurrent
        ? action === "cancel" ? await controller.cancel() : await controller.resume()
        : action === "cancel" ? await taskProvider.cancel(item.taskId) : await taskProvider.resume(item.taskId);
      if (!snapshot) return;
      setTaskHistory((current) => current.map((record) => record.taskId === item.taskId ? { ...record, snapshot } : record));
    } catch (value) {
      setTaskHistoryMessage(value instanceof Error ? value.message : String(value));
    }
  }, [cloudProvider, controller, localProvider, pipeline.snapshot?.task_id]);

  const clearTaskHistory = useCallback(() => {
    const active = taskHistoryRef.current.filter((item) => activeStates.has(item.snapshot.state));
    const clearedCount = taskHistoryRef.current.length - active.length;
    if (clearedCount === 0) return;
    setTaskHistory(active);
    setTaskHistoryMessage(active.length > 0
      ? `已清除 ${clearedCount} 条历史记录，进行中的任务已保留。`
      : "任务列表已清空。");
  }, []);

  const startMedia = useCallback(async (entry: MediaEntry) => {
    setLibraryMessage("");
    setTranscriptionError("");
    setTranscriptionMedia(entry);
  }, []);

  const confirmTranscription = useCallback(async (mode: ExecutionMode, request: TaskRequest) => {
    if (!transcriptionMedia) return;
    setTranscriptionBusy(true);
    setTranscriptionError("");
    try {
      if (mode === "cloud" && !cloudSession?.authenticated) {
        throw new Error("请先使用 Key 登录云端账户");
      }
      const taskController = mode === "local" ? localController : cloudController;
      setExecutionMode(mode);
      const snapshot = await taskController.start(request);
      setActiveMedia(transcriptionMedia);
      rememberTask(snapshot, transcriptionMedia);
      setTranscriptionMedia(null);
      setSection("tasks");
      void mediaLibrary.cacheMedia(transcriptionMedia.id).then(() => Promise.all([loadLibrary(), loadCacheStatus()])).catch((value) => {
        setLibraryMessage(`任务已启动，但视频缓存创建失败：${value instanceof Error ? value.message : String(value)}`);
      });
    } catch (value) {
      setTranscriptionError(value instanceof Error ? value.message : String(value));
    } finally {
      setTranscriptionBusy(false);
    }
  }, [cloudController, cloudSession?.authenticated, loadCacheStatus, loadLibrary, localController, rememberTask, transcriptionMedia]);

  const saveCacheLimit = useCallback(async (limit: number) => {
    setCacheBusy(true);
    setCacheMessage("");
    try {
      setCacheStatus(await mediaLibrary.setCacheLimitGB(limit));
      await loadLibrary();
      setCacheMessage("缓存上限已保存，超出部分已按最近使用时间回收。");
    } catch (value) {
      setCacheMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setCacheBusy(false);
    }
  }, [loadLibrary]);

  const clearCache = useCallback(async () => {
    setCacheBusy(true);
    setCacheMessage("");
    try {
      const status = await mediaLibrary.clearVideoCache();
      setCacheStatus(status);
      await loadLibrary();
      setCacheMessage(status.files > 0 ? "已清理缓存；正在编辑的视频副本暂时保留。" : "视频缓存已清理。");
    } catch (value) {
      setCacheMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setCacheBusy(false);
    }
  }, [loadLibrary]);

  useEffect(() => {
    if (!pipeline.snapshot || !activeMedia) return;
    rememberTask(pipeline.snapshot, activeMedia);
  }, [activeMedia, pipeline.snapshot, rememberTask]);

  useEffect(() => {
    const snapshot = pipeline.snapshot;
    if (!snapshot || snapshot.provider !== "local" || snapshot.state !== "completed" || !pipeline.artifacts || !activeMedia || !cloudSession?.authenticated) return;
    if (syncedTasks.current.has(snapshot.task_id)) return;
    syncedTasks.current.add(snapshot.task_id);
    setAccountMessage("正在把本机字幕同步到云端…");
    void cloudAccount.syncLocalTask(snapshot.task_id, activeMedia.id, activeMedia.fingerprint, activeMedia.title, activeMedia.duration)
      .then(async () => {
        setAccountMessage("本机字幕已自动同步到云端。");
        setCloudMedia(await cloudAccount.library());
      })
      .catch((value) => {
        syncedTasks.current.delete(snapshot.task_id);
        setAccountMessage(`自动同步失败：${value instanceof Error ? value.message : String(value)}`);
      });
  }, [activeMedia, cloudSession?.authenticated, pipeline.artifacts, pipeline.snapshot]);

  useEffect(() => {
    const snapshot = pipeline.snapshot;
    if (!snapshot || snapshot.state !== "completed" || !pipeline.artifacts || !activeMedia) return;
    if (openedTasks.current.has(snapshot.task_id)) return;
    openedTasks.current.add(snapshot.task_id);
    void loadLibrary().finally(() => {
      void openEditor(activeMedia);
    });
  }, [activeMedia, loadLibrary, openEditor, pipeline.artifacts, pipeline.snapshot]);

  const renameMedia = useCallback((entry: MediaEntry) => {
    setDialog({ kind: "rename", entry, value: entry.title });
  }, []);

  const removeMedia = useCallback((entry: MediaEntry) => {
    setDialog({ kind: "remove", entry, deleteDocument: false });
  }, []);

  const deleteCloudMedia = useCallback((entry: CloudEntry) => {
    setDialog({ kind: "cloud-remove", entry });
  }, []);

  const submitDialog = useCallback(async () => {
    if (!dialog) return;
    setDialogBusy(true);
    try {
      if (dialog.kind === "rename") {
        const title = dialog.value.trim();
        if (!title || title === dialog.entry.title) {
          setDialog(null);
          return;
        }
        await mediaLibrary.rename(dialog.entry.id, title);
      } else if (dialog.kind === "remove") {
        await mediaLibrary.remove(dialog.entry.id, dialog.deleteDocument);
      } else {
        await cloudAccount.deleteLibraryEntry(dialog.entry.id);
        setTaskHistory((current) => current.filter((item) => item.taskId !== dialog.entry.id));
      }
      setDialog(null);
      await (dialog.kind === "cloud-remove" ? loadCloud() : loadLibrary());
    } catch (value) {
      setLibraryMessage(value instanceof Error ? value.message : String(value));
      setDialog(null);
    } finally {
      setDialogBusy(false);
    }
  }, [dialog, loadCloud, loadLibrary]);

  const relinkMedia = useCallback(async (entry: MediaEntry) => {
    try {
      await mediaLibrary.relink(entry.id);
      await loadLibrary();
    } catch (value) {
      setLibraryMessage(value instanceof Error ? value.message : String(value));
    }
  }, [loadLibrary]);

  const login = useCallback(async () => {
    setAccountBusy(true);
    setCloudLoading(true);
    setAccountMessage("");
    try {
      const session = await cloudAccount.login(DEFAULT_CLOUD_BACKEND, loginKey);
      setCloudSession(session);
      setLoginKey("");
      setCloudMedia(await cloudAccount.library());
      setCloudCapabilities(await cloudProvider.capabilities().catch(() => null));
      setAccountMessage(
        session.syncError
          ? `登录成功，但自动同步检查失败：${session.syncError}`
          : `登录成功，已合并视频库并补同步 ${session.synced ?? 0} 个本地字幕${session.syncFailed ? `，${session.syncFailed} 个失败` : ""}。`,
      );
      setSection("library");
    } catch (value) {
      setAccountMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setAccountBusy(false);
      setCloudLoading(false);
    }
  }, [cloudProvider, loginKey]);

  const logout = useCallback(async () => {
    await cloudAccount.logout();
    setCloudSession({ authenticated: false, running: 0 });
    setCloudMedia([]);
    setCloudCapabilities(null);
    setAccountMessage("已退出；本地媒体库保持不变。");
  }, []);

  const saveKeys = useCallback(async (updates: Record<string, string | null>, keyName: string) => {
    const payload = Object.fromEntries(Object.entries(updates).map(([name, value]) => [name, typeof value === "string" ? value.trim() : value]));
    if (!Object.keys(payload).length) {
      setKeysMessage("请输入 Key 后再保存。");
      return;
    }
    setKeysBusy(true);
    setKeysMessage("");
    try {
      setSettings(await fineSubSettings.saveKeys(payload));
      setKeyDraft((current) => Object.fromEntries(Object.entries(current).map(([name, value]) => [name, Object.hasOwn(payload, name) ? "" : value])));
      setKeysMessage(`${keyName} 已保存。`);
      await refresh();
    } catch (value) {
      setKeysMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setKeysBusy(false);
    }
  }, [refresh]);

  const installRuntime = useCallback(async (target: "media" | "runtime" | "models" | "all") => {
    try {
      setRuntimeProvision(await fineSubRuntime.install(target));
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  }, []);

  const runtimeReady = capabilities?.runtime?.ready === true;
  const issues = capabilities?.runtime?.issues ?? [];
  const title = section === "library"
    ? "媒体库"
    : section === "tasks"
      ? "处理任务"
      : section === "runtime"
          ? "运行环境"
          : section === "account"
            ? "云端账户"
            : section === "adminKeys"
              ? "Key 管理"
              : "设置";
  const remoteByFingerprint = useMemo(() => new Map(cloudMedia.filter((entry) => entry.fingerprint).map((entry) => [entry.fingerprint, entry])), [cloudMedia]);
  const cloudOnly = useMemo(() => {
    const localFingerprints = new Set(media.map((entry) => entry.fingerprint));
    return cloudMedia.filter((entry) => !entry.fingerprint || !localFingerprints.has(entry.fingerprint));
  }, [cloudMedia, media]);
  const taskActive = activeStates.has(pipeline.snapshot?.state ?? "");
  const rememberedActiveTaskCount = taskHistory.filter((item) => activeStates.has(item.snapshot.state)).length;
  const activeTaskCount = Math.max(rememberedActiveTaskCount, taskActive ? 1 : 0, cloudSession?.running ?? 0);
  const localRunningID = taskActive ? activeMedia?.id : undefined;
  const libraryItems = useMemo<LibraryItem[]>(() => [
    ...media.map((entry): LibraryItem => ({ kind: "local", entry })),
    ...cloudOnly.map((entry): LibraryItem => ({ kind: "cloud", entry })),
  ], [cloudOnly, media]);
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return libraryItems.filter((item) => {
      const entry = item.entry;
      const matchesQuery = !needle || entry.title.toLocaleLowerCase().includes(needle)
        || (item.kind === "local" && item.entry.sourcePath.toLocaleLowerCase().includes(needle));
      if (!matchesQuery) return false;
      if (libraryFilter === "all") return true;
      if (libraryFilter === "cloud") return item.kind === "cloud";
      if (libraryFilter === "running") {
        return item.kind === "local"
          ? item.entry.id === localRunningID
          : activeStates.has(item.entry.status);
      }
      if (item.kind === "cloud") return false;
      if (libraryFilter === "ready") return item.entry.documentAvailable;
      return !item.entry.available;
    }).sort((left, right) => {
      if (sortMode === "name") return left.entry.title.localeCompare(right.entry.title, "zh-CN");
      if (sortMode === "duration") return right.entry.duration - left.entry.duration;
      const leftTime = left.kind === "local" ? left.entry.lastAccess || left.entry.addedAt : Date.parse(left.entry.updatedAt);
      const rightTime = right.kind === "local" ? right.entry.lastAccess || right.entry.addedAt : Date.parse(right.entry.updatedAt);
      return rightTime - leftTime;
    });
  }, [libraryFilter, libraryItems, localRunningID, query, sortMode]);
  const filterCounts: Record<LibraryFilter, number> = {
    all: libraryItems.length,
    ready: media.filter((entry) => entry.documentAvailable).length,
    running: media.filter((entry) => entry.id === localRunningID).length + cloudOnly.filter((entry) => activeStates.has(entry.status)).length,
    cloud: cloudOnly.length,
    missing: media.filter((entry) => !entry.available).length,
  };
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} data-file-drop-target>
      <WindowDropOverlay onFilesDropped={handleDroppedFiles} />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-glyph">F</span>
          <span className="brand-name">Finoka</span>
          <button className="sidebar-collapse" aria-label={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"} onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? "›" : "‹"}</button>
        </div>
        <span className="nav-label">工作区</span>
        <nav aria-label="主导航">
          {(["library", "tasks"] as const satisfies readonly NavigationSection[]).map((item) => (
            <button className={section === item ? "active" : ""} key={item} title={item === "library" ? "媒体库" : "处理任务"} onClick={() => setSection(item)}>
              <NavIcon kind={item} />
              <span className="nav-text">{item === "library" ? "媒体库" : "处理任务"}</span>
              {item === "library" && libraryItems.length > 0 && <small className="nav-count">{libraryItems.length}</small>}
              {item === "tasks" && activeTaskCount > 0 && <small className="nav-count active-count">{activeTaskCount}</small>}
            </button>
          ))}
        </nav>
        <span className="nav-label management-label">管理</span>
        <nav aria-label="管理导航">
          <button className={section === "runtime" ? "active" : ""} title="运行环境" onClick={() => setSection("runtime")}>
            <NavIcon kind="runtime" />
            <span className="nav-text">运行环境</span>
          </button>
          <button className={section === "keys" ? "active" : ""} title="设置" onClick={() => setSection("keys")}>
            <NavIcon kind="settings" />
            <span className="nav-text">设置</span>
          </button>
          {cloudSession?.admin && <button className={section === "adminKeys" ? "active" : ""} title="Key 管理" onClick={() => setSection("adminKeys")}>
            <NavIcon kind="adminKeys" />
            <span className="nav-text">Key 管理</span>
          </button>}
        </nav>
        <div className="sidebar-spacer" />
        <section className="sidebar-provider" aria-label="执行位置">
          <div className="sidebar-provider-status">
            <span className={`status-dot ${executionMode === "cloud" ? "online" : sidecar?.running ? "local" : ""}`} />
            <div>
              <strong>{executionMode === "cloud" ? "Nonoka Cloud" : "本地运行"}</strong>
              <small>{executionMode === "cloud" ? cloudSession?.admin ? "管理员 · 不限次" : `剩余 ${cloudSession?.remaining ?? "—"} 次` : runtimeReady ? "运行环境已就绪" : "需要检查环境"}</small>
            </div>
          </div>
          <div className="sidebar-provider-switch">
            <button className={executionMode === "local" ? "active" : ""} disabled={taskActive} onClick={() => setExecutionMode("local")}>本机</button>
            <button className={executionMode === "cloud" ? "active" : ""} disabled={taskActive} onClick={() => cloudSession?.authenticated ? setExecutionMode("cloud") : setSection("account")}>云端</button>
          </div>
        </section>
        <button className="sidebar-account" aria-busy={cloudLoading} disabled={cloudLoading} onClick={() => setSection("account")} title="云端账户">
          <span className={`account-avatar ${cloudLoading ? "loading" : ""}`}>{cloudLoading ? <span className="account-spinner" aria-hidden="true" /> : "F"}</span>
          <span className="account-copy">
            <strong>{cloudLoading ? "正在验证账户" : cloudSession?.authenticated ? cloudSession.name || "未命名 Key" : "未登录云端"}</strong>
            <small>{cloudLoading ? "同步中" : cloudSession?.authenticated ? `已同步 ${cloudMedia.length} 个字幕记录` : "登录后同步媒体库"}</small>
          </span>
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
          </div>
          {section === "library" && <label className="library-search"><span>⌕</span><input type="search" placeholder="搜索标题或文件名" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
          <div className="topbar-actions">
            <button className="theme-button" aria-label="切换主题" title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} onClick={() => setTheme((value) => value === "dark" ? "light" : "dark")}>{theme === "dark" ? "☼" : "◐"}</button>
            {section === "library" ? (
              <button className="primary-button" disabled={libraryBusy} onClick={() => void importMedia()}>{libraryBusy ? "正在导入…" : "＋ 添加媒体"}</button>
            ) : section === "tasks" ? (
              <button className="quiet-button" onClick={() => void refreshTaskHistory()} disabled={taskHistoryBusy}>{taskHistoryBusy ? "正在刷新…" : "刷新任务"}</button>
            ) : section === "runtime" ? (
              <button className="quiet-button" onClick={() => void refresh()} disabled={loadState === "loading"}>{loadState === "loading" ? "正在检查…" : "重新检查"}</button>
            ) : null}
          </div>
        </header>

        {(section === "library" || section === "tasks") && <section className={`runtime-banner ${runtimeReady ? "ready" : "warning"}`}>
          <div className="runtime-symbol">{runtimeReady ? "✓" : "!"}</div>
          <div className="runtime-copy">
            <span className="eyebrow">本地执行环境</span>
            <h2>
              {runtimeReady
                ? "引擎已准备就绪"
                : loadState === "loading"
                  ? "正在连接本地服务"
                  : "需要完成运行时配置"}
            </h2>
            <p>
              {runtimeReady
                ? `FineSub ${capabilities.engine.version} · ${capabilities.engine.commit.slice(0, 12)}`
                : message || issues[0]?.message || "正在读取 capabilities…"}
            </p>
          </div>
          <button onClick={() => setSection("runtime")}>查看详情 →</button>
        </section>}

        {section === "library" && (
          <LibraryPage
            items={libraryItems}
            visibleItems={visibleItems}
            thumbnails={thumbnails}
            remoteByFingerprint={remoteByFingerprint}
            filter={libraryFilter}
            filterCounts={filterCounts}
            sort={sortMode}
            view={viewMode}
            busy={libraryBusy}
            message={libraryMessage}
            localRunningID={localRunningID}
            runningProgress={pipeline.snapshot?.progress?.total ? Math.min(100, pipeline.snapshot.progress.completed / pipeline.snapshot.progress.total * 100) : 8}
            taskActive={taskActive}
            syncing={cloudLoading}
            setFilter={setLibraryFilter}
            setSort={setSortMode}
            setView={setViewMode}
            onClearQuery={() => setQuery("")}
            onImport={importMedia}
            onOpen={(entry) => void openEditor(entry)}
            onStart={startMedia}
            onRename={renameMedia}
            onRemove={removeMedia}
            onDeleteCloud={deleteCloudMedia}
            onRelink={relinkMedia}
          />
        )}

        {section === "tasks" && (
          <TasksPage
            tasks={taskHistory}
            media={media}
            activeCount={activeTaskCount}
            message={taskHistoryMessage}
            pipelineError={pipeline.error?.message}
            onNavigateLibrary={() => setSection("library")}
            onOpenEditor={(entry) => void openEditor(entry)}
            onClearTasks={clearTaskHistory}
            onTaskAction={actOnHistoryTask}
          />
        )}

        {section === "runtime" && (
          <RuntimePage capabilities={capabilities} message={message} provision={runtimeProvision} ready={runtimeReady} sidecar={sidecar} onInstall={installRuntime} />
        )}

        {section === "keys" && (
          <SettingsPage
            settings={settings}
            drafts={keyDraft}
            busy={keysBusy}
            message={keysMessage}
            cache={cacheStatus}
            cacheBusy={cacheBusy}
            cacheMessage={cacheMessage}
            setDrafts={setKeyDraft}
            onSaveKey={saveKeys}
            onSaveCacheLimit={saveCacheLimit}
            onClearCache={clearCache}
          />
        )}

        {section === "adminKeys" && cloudSession?.admin && <AdminKeysPage />}

        {section === "account" && (
          <AccountPage session={cloudSession} media={cloudMedia} loginKey={loginKey} busy={accountBusy} message={accountMessage} onLoginKeyChange={setLoginKey} onLogin={login} onLogout={logout} />
        )}
      </main>

      {dialog && <MediaDialog dialog={dialog} busy={dialogBusy} setDialog={setDialog} onSubmit={submitDialog} />}
      {transcriptionMedia && <TranscriptionDialog
        entry={transcriptionMedia}
        initialMode={executionMode}
        localReady={runtimeReady}
        localCapabilities={capabilities}
        cloudCapabilities={cloudCapabilities}
        localIssue={message || issues[0]?.message}
        cloudAuthenticated={cloudSession?.authenticated === true}
        cloudRemaining={cloudSession?.remaining ?? undefined}
        busy={transcriptionBusy}
        error={transcriptionError}
        onClose={() => { if (!transcriptionBusy) setTranscriptionMedia(null); }}
        onOpenRuntime={() => { setTranscriptionMedia(null); setSection("runtime"); }}
        onOpenAccount={() => { setTranscriptionMedia(null); setSection("account"); }}
        onStart={confirmTranscription}
      />}
    </div>
  );
}
