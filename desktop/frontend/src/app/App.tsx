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
import type { PythonBootstrapState, RuntimeInstallTarget, RuntimeProvisionState } from "../bridge/runtime.ts";
import { desktopPreferences } from "../bridge/preferences.ts";
import { desktopPlugins, mountedTools } from "../bridge/plugins.ts";
import type { InstalledPlugin, MountedPluginTool } from "../bridge/plugins.ts";
import { desktopWindows } from "../bridge/windows.ts";
import { localProviderBridge, sidecarStatus } from "../bridge/wails.ts";
import { PipelineController } from "../home/pipelineController.ts";
import { CloudExecutionProvider } from "../providers/cloudProvider.ts";
import type { PipelineState } from "../home/pipelineController.ts";
import { LocalExecutionProvider } from "../providers/localProvider.ts";
import type { Capabilities, TaskRequest, TaskSnapshot } from "../providers/types.ts";
import { MediaDialog } from "../components/MediaDialog.tsx";
import type { NoticeTone } from "../components/Notice.tsx";
import { TranscriptionDialog } from "../components/TranscriptionDialog.tsx";
import { UpdateButton, UpdateOverlay, useSelfUpdate } from "../components/UpdateCenter.tsx";
import { WindowDropOverlay } from "../components/WindowDropOverlay.tsx";
import { AccountPage } from "../pages/AccountPage.tsx";
import { AboutPage } from "../pages/AboutPage.tsx";
import { AdminKeysPage } from "../pages/AdminKeysPage.tsx";
import { RuntimePage } from "../pages/RuntimePage.tsx";
import { SettingsPage } from "../pages/SettingsPage.tsx";
import { TasksPage } from "../pages/TasksPage.tsx";
import { LibraryPage } from "../pages/LibraryPage.tsx";
import { PluginManagerPage } from "../plugins/PluginManagerPage.tsx";
import { PluginPageHost } from "../plugins/PluginPageHost.tsx";
import { parseTaskHistory } from "./format.ts";
import { applyTheme, initialTheme } from "./theme.ts";
import type { DialogState, ExecutionMode, LibraryFilter, LibraryItem, LoadState, NavigationSection, Section, SortMode, TaskHistoryEntry, Theme, ViewMode } from "./types.ts";
import { activeStates, taskHistoryLimit } from "./types.ts";

const taskPollIntervalMs = 10_000;
// Reconnect attempts while the local sidecar is not answering.
const sidecarRetryIntervalMs = 4_000;

/** Library notices carry their own tone so a completed action does not read as a
    warning. The helpers are module level, keeping setState callers dependency free. */
type LibraryNotice = { text: string; tone: NoticeTone };
const noNotice: LibraryNotice = { text: "", tone: "warn" };
const warnNotice = (text: string): LibraryNotice => ({ text, tone: "warn" });
const okNotice = (text: string): LibraryNotice => ({ text, tone: "success" });

function NavIcon({ kind }: { kind: NavigationSection }) {
  const paths = {
    library: "M4 6.5h16M6 3h12a2 2 0 0 1 2 2v14H4V5a2 2 0 0 1 2-2Zm3 7h6m-6 4h4",
    tasks: "M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5",
    plugins: "M8 3v4m8-4v4M6 7h12v4a6 6 0 0 1-5 5.9V21h-2v-4.1A6 6 0 0 1 6 11V7Z",
    runtime: "M4 5h16v14H4zM8 9h3m2 0h3m-8 4h8m-8 3h5",
    adminKeys: "M8.5 14.5 14 9m-1.5-2.5a3.5 3.5 0 1 1 5 5l-1 1-2-2-2 2-2-2-2 2-2.5-2.5 1-1Z",
    settings:
      "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2m0 13v2m8.5-8.5h-2m-13 0h-2m15-6.5-1.4 1.4M6.9 17.1l-1.4 1.4m13 0-1.4-1.4M6.9 6.9 5.5 5.5",
    about: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-10v.01",
  } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[kind]} />
    </svg>
  );
}

function PluginToolIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5l3 3-3 3v5H7v-5l-3-3 3-3V4Zm3 4h4m-4 4h4m-4 4h4" /></svg>;
}

export default function App() {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("local");
  const localProvider = useMemo(() => new LocalExecutionProvider(localProviderBridge), []);
  const cloudProvider = useMemo(() => new CloudExecutionProvider(cloudAccount), []);
  const localController = useMemo(() => new PipelineController(localProvider), [localProvider]);
  const cloudController = useMemo(() => new PipelineController(cloudProvider), [cloudProvider]);
  const controller = executionMode === "local" ? localController : cloudController;
  const [section, setSection] = useState<Section>("library");
  const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
  const [activePluginTool, setActivePluginTool] = useState<{ pluginId: string; toolId: string } | null>(null);
  const [pluginBusy, setPluginBusy] = useState("");
  const [pluginMessage, setPluginMessage] = useState("");
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
  const [cloudThumbnails, setCloudThumbnails] = useState<Record<string, string>>({});
  const [adoptFailed, setAdoptFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [adoptingCloud, setAdoptingCloud] = useState<ReadonlySet<string>>(() => new Set());
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState<LibraryNotice>(noNotice);
  const [cacheStatus, setCacheStatus] = useState<CacheStatus | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMessage, setCacheMessage] = useState("");
  const [pipeline, setPipeline] = useState<PipelineState>(controller.current() as PipelineState);
  const [taskHistory, setTaskHistory] = useState<TaskHistoryEntry[]>([]);
  const [taskHistoryBusy, setTaskHistoryBusy] = useState(false);
  const [taskHistoryMessage, setTaskHistoryMessage] = useState("");
  const [settings, setSettings] = useState<FineSubSettingsState | null>(null);
  const [runtimeProvision, setRuntimeProvision] = useState<RuntimeProvisionState | null>(null);
  const [pythonBootstrap, setPythonBootstrap] = useState<PythonBootstrapState | null>(null);
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
  const selfUpdate = useSelfUpdate();
  const cloudThumbnailsTried = useRef(new Set<string>());
  const adoptedCloudEntries = useRef(new Set<string>());
  const syncedTasks = useRef(new Set<string>());
  const completedTasks = useRef(new Set<string>());
  const taskHistoryHydrated = useRef(false);
  const preferencesHydrated = useRef(false);
  const taskHistoryRef = useRef(taskHistory);
  const pythonBootstrapStarted = useRef(false);

  const refreshPlugins = useCallback(async () => {
    setPlugins(await desktopPlugins.list());
  }, []);

  useEffect(() => {
    void refreshPlugins().catch(() => undefined);
    return Events.On("plugins:changed", () => { void refreshPlugins().catch(() => undefined); });
  }, [refreshPlugins]);

  const pluginTools = useMemo(() => mountedTools(plugins), [plugins]);
  const activeMountedPlugin = useMemo<MountedPluginTool | null>(() => {
    if (!activePluginTool) return null;
    return pluginTools.find((item) => item.pluginId === activePluginTool.pluginId && item.tool.id === activePluginTool.toolId) ?? null;
  }, [activePluginTool, pluginTools]);

  useEffect(() => {
    if (section === "plugin" && !activeMountedPlugin) {
      setActivePluginTool(null);
      setSection("plugins");
    }
  }, [activeMountedPlugin, section]);

  const openPluginTool = useCallback((pluginId: string, toolId: string) => {
    setActivePluginTool({ pluginId, toolId });
    setSection("plugin");
  }, []);

  const installPlugin = useCallback(async () => {
    setPluginBusy("install");
    setPluginMessage("");
    try {
      const installed = await desktopPlugins.install();
      await refreshPlugins();
      if (installed.id) setPluginMessage(`已安装插件“${installed.name}”`);
    } catch (value) {
      setPluginMessage(`安装失败：${value instanceof Error ? value.message : String(value)}`);
    } finally {
      setPluginBusy("");
    }
  }, [refreshPlugins]);

  const togglePlugin = useCallback(async (plugin: InstalledPlugin) => {
    setPluginBusy(plugin.id);
    setPluginMessage("");
    try {
      await desktopPlugins.setEnabled(plugin.id, !plugin.enabled);
      await refreshPlugins();
      setPluginMessage(`${plugin.enabled ? "已停用" : "已启用"}插件“${plugin.name}”`);
    } catch (value) {
      setPluginMessage(`操作失败：${value instanceof Error ? value.message : String(value)}`);
    } finally {
      setPluginBusy("");
    }
  }, [refreshPlugins]);

  const uninstallPlugin = useCallback(async (plugin: InstalledPlugin, removeData: boolean) => {
    setPluginBusy(plugin.id);
    setPluginMessage("");
    try {
      await desktopPlugins.uninstall(plugin.id, removeData);
      await refreshPlugins();
      setPluginMessage(`已卸载插件“${plugin.name}”${removeData ? "并删除其数据" : "，插件数据已保留"}`);
    } catch (value) {
      setPluginMessage(`卸载失败：${value instanceof Error ? value.message : String(value)}`);
    } finally {
      setPluginBusy("");
    }
  }, [refreshPlugins]);

  useEffect(() => {
    taskHistoryRef.current = taskHistory;
    if (preferencesHydrated.current) void desktopPreferences.save({ taskHistory: taskHistory.slice(0, taskHistoryLimit) }).catch(() => undefined);
  }, [taskHistory]);

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

  // `silent` keeps the automatic reconnect polling from flashing the loading
  // state on every tick; explicit user refreshes still show their progress.
  const refresh = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoadState("loading");
      setMessage("");
    }
    try {
      const [status, bootstrap] = await Promise.all([sidecarStatus(), fineSubRuntime.pythonStatus()]);
      setSidecar(status);
      setPythonBootstrap(bootstrap);
      if (!status.running) {
        setCapabilities(null);
        // Without this the panel keeps offering install buttons against a
        // sidecar that is no longer answering.
        setRuntimeProvision(null);
        setMessage(bootstrap.state === "running" ? bootstrap.message : status.error || bootstrap.message || "本地执行服务尚未启动");
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

  // Cloud-only entries have no local file to draw a frame from, so their cover
  // comes from the bucket the task uploaded it to. Each id is attempted once
  // per session: an entry started by a desktop that had no cover to send will
  // never grow one, and retrying on every library refresh only costs requests.
  useEffect(() => {
    const pending = cloudMedia.filter((entry) => entry.thumbnailAvailable && !cloudThumbnailsTried.current.has(entry.id));
    if (pending.length === 0) return;
    pending.forEach((entry) => cloudThumbnailsTried.current.add(entry.id));
    // Not cancelled on re-run either: the ids are already marked as tried, so
    // a teardown mid-fetch would lose those covers for the rest of the session.
    void Promise.all(pending.map(async (entry) => {
      try {
        return [entry.id, await cloudAccount.thumbnail(entry.id)] as const;
      } catch {
        return null;
      }
    })).then((pairs) => {
      const resolved = pairs.filter((pair) => pair !== null);
      if (resolved.length === 0) return;
      setCloudThumbnails((current) => ({ ...current, ...Object.fromEntries(resolved) }));
    });
  }, [cloudMedia]);

  const loadLibrary = useCallback(async () => {
    try {
      const entries = await mediaLibrary.list();
      setMedia(entries);
      await hydrateThumbnails(entries);
    } catch (value) {
      const detail = value instanceof Error ? value.message : String(value ?? "");
      setLibraryMessage(warnNotice(detail || "无法连接本地媒体库"));
    }
  }, [hydrateThumbnails]);

  // A cloud entry only merges into a local card by fingerprint, which makes it
  // look synced while the subtitles still live entirely in the cloud: the card
  // says 字幕已同步 and the button still offers to transcribe the media again.
  // This is the set of media that answers to a finished cloud entry and has no
  // local document yet -- derived during render rather than recorded when the
  // download starts, because a card that renders before the effect has run
  // would offer 开始转写 for that frame and spend a cloud task if clicked.
  const pendingAdoptions = useMemo(() => {
    if (!cloudSession?.authenticated) return [];
    return media
      // The media this app is transcribing right now is excluded: its own
      // pipeline projects the result the moment the task finishes, and both
      // paths would otherwise download the same artifacts at once.
      .filter((entry) => entry.available && !entry.documentAvailable && entry.fingerprint && entry.id !== activeMedia?.id)
      .flatMap((entry) => {
        const remote = cloudMedia.find((item) => item.status === "completed" && item.fingerprint === entry.fingerprint);
        return remote ? [{ key: `${remote.id}:${entry.id}`, localID: entry.id, videoID: remote.id }] : [];
      })
      .filter((pair) => !adoptFailed.has(pair.key));
  }, [activeMedia?.id, adoptFailed, cloudMedia, cloudSession?.authenticated, media]);
  const adoptingMedia = useMemo(() => new Set(pendingAdoptions.map((pair) => pair.localID)), [pendingAdoptions]);

  // Pull the finished text down, once per pair, whether the media arrived
  // through 关联本地视频, a plain import or a relink. Deliberately not
  // cancelled on re-run: the adoption changes the very library the set above
  // is derived from, so this re-runs while the download is still in flight,
  // and tearing the run down there dropped the refresh that makes the new
  // document visible. The tried-set is what keeps the work from repeating.
  useEffect(() => {
    const fresh = pendingAdoptions.filter((pair) => !adoptedCloudEntries.current.has(pair.key));
    if (fresh.length === 0) return;
    fresh.forEach((pair) => adoptedCloudEntries.current.add(pair.key));
    void (async () => {
      const adopted = new Set<string>();
      const failed = new Set<string>();
      for (const pair of fresh) {
        // Sequential on purpose: each projection round-trips through the local
        // provider.
        try {
          await cloudAccount.adoptLibraryEntry(pair.videoID, pair.localID);
          adopted.add(pair.localID);
        } catch {
          // Left for the user to transcribe locally: recording the failure is
          // what puts 开始转写 back on the card.
          failed.add(pair.key);
        }
      }
      if (failed.size > 0) setAdoptFailed((current) => new Set([...current, ...failed]));
      if (adopted.size === 0) return;
      setLibraryMessage(okNotice(`已从云端取回 ${adopted.size} 个视频的字幕，可以直接编辑。`));
      await loadLibrary();
      // The document exists -- this code is what wrote it. Asserting that on
      // top of the refresh keeps a library:changed snapshot taken before the
      // projection from putting these cards back to 取回字幕中.
      setMedia((current) => current.map((entry) => adopted.has(entry.id) ? { ...entry, documentAvailable: true } : entry));
    })();
  }, [loadLibrary, pendingAdoptions]);

  // Editing a cloud entry whose video never reached this machine. The
  // subtitles are what the user came for; the library keeps a placeholder for
  // the fingerprint so the document has an owner, and 关联视频 later fills that
  // same entry in.
  const editCloudEntry = useCallback(async (entry: CloudEntry) => {
    setLibraryMessage(noNotice);
    setAdoptingCloud((current) => new Set([...current, entry.id]));
    try {
      const localID = await cloudAccount.adoptCloudEntry(entry.id);
      await loadLibrary();
      await desktopWindows.openEditor(localID);
    } catch (value) {
      const detail = value instanceof Error ? value.message : String(value ?? "");
      setLibraryMessage(warnNotice(detail || "无法取回云端字幕"));
      await loadLibrary();
    } finally {
      setAdoptingCloud((current) => new Set([...current].filter((id) => id !== entry.id)));
    }
  }, [loadLibrary]);

  const openEditor = useCallback(async (entry: MediaEntry) => {
    setLibraryMessage(noNotice);
    try {
      await desktopWindows.openEditor(entry.id);
    } catch (value) {
      setLibraryMessage(warnNotice(value instanceof Error ? value.message : String(value)));
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
      setLibraryMessage(warnNotice(failures.map((failure) => `${failure.name}: ${failure.message}`).join("；")));
    } else if ((result.added ?? []).length > 0) {
      setLibraryMessage(okNotice(`已导入 ${(result.added ?? []).length} 个本地媒体`));
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
    setLibraryMessage(noNotice);
    try {
      const result = paths ? await mediaLibrary.importPaths(paths) : await mediaLibrary.pickAndImport();
      await acceptImport(result);
    } catch (value) {
      const detail = value instanceof Error ? value.message : String(value ?? "");
      setLibraryMessage(warnNotice(detail || "媒体导入失败"));
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
        if (status.job.state !== "running") void refresh();
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
        if (warning) setLibraryMessage((current) => warnNotice(current.text ? `${current.text}；${warning}` : warning));
      });
    } else if (warning) {
      setLibraryMessage(warnNotice(warning));
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
      // "继续" covers three states, and the local provider accepts only one of
      // them through resume: a shutdown leaves a task interrupted, while a
      // cancelled or failed one has to be retried. Both reuse the engine's
      // checkpoints, so the button means the same thing to the user either way.
      const restart = item.snapshot.state === "interrupted" ? "resume" : "retry";
      const snapshot = isCurrent
        ? action === "cancel"
          ? await controller.cancel()
          : restart === "resume" ? await controller.resume() : await controller.retry()
        : action === "cancel"
          ? await taskProvider.cancel(item.taskId)
          : restart === "resume" ? await taskProvider.resume(item.taskId) : await taskProvider.retry(item.taskId);
      if (!snapshot) return;
      setTaskHistory((current) => current.map((record) => record.taskId === item.taskId ? { ...record, snapshot } : record));
    } catch (value) {
      setTaskHistoryMessage(value instanceof Error ? value.message : String(value));
    }
  }, [cloudProvider, controller, localProvider, pipeline.snapshot?.task_id]);

  /** The library locks every start button while a task runs, so the card that
      shows the progress is also where the way out belongs -- reaching the task
      history page should not be the only way to stop a run. */
  const cancelActiveTask = useCallback(async () => {
    const taskId = pipeline.snapshot?.task_id;
    if (!taskId) return;
    setLibraryMessage(noNotice);
    try {
      const snapshot = await controller.cancel();
      if (!snapshot) return;
      setTaskHistory((current) => current.map((record) => record.taskId === taskId ? { ...record, snapshot } : record));
      setLibraryMessage(okNotice("已取消处理。已完成的环节会保留，可在处理历史中继续。"));
    } catch (value) {
      setLibraryMessage(warnNotice(value instanceof Error ? value.message : String(value)));
    }
  }, [controller, pipeline.snapshot?.task_id]);

  // Cloud tasks report stages, not engine output, so the log reader is wired
  // to the local provider alone and the task list hides the toggle elsewhere.
  const localTaskLogs = useCallback(
    (taskId: string, afterCursor: number) => localProvider.events(taskId, afterCursor),
    [localProvider],
  );

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
    setLibraryMessage(noNotice);
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
        setLibraryMessage(warnNotice(`任务已启动，但视频缓存创建失败：${value instanceof Error ? value.message : String(value)}`));
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
    if (!snapshot || snapshot.state !== "completed" || !pipeline.artifacts) return;
    if (completedTasks.current.has(snapshot.task_id)) return;
    completedTasks.current.add(snapshot.task_id);
    void loadLibrary();
    void loadCacheStatus();
    if (activeMedia) {
      setLibraryMessage(okNotice(`"${activeMedia.title}" 字幕处理完成，可以直接编辑。`));
    }
  }, [activeMedia, loadCacheStatus, loadLibrary, pipeline.artifacts, pipeline.snapshot]);

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
      setLibraryMessage(warnNotice(value instanceof Error ? value.message : String(value)));
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
      setLibraryMessage(warnNotice(value instanceof Error ? value.message : String(value)));
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
      setKeyDraft((current) => Object.fromEntries(Object.entries(current).filter(([name]) => !Object.hasOwn(payload, name))));
      setKeysMessage(`${keyName} 已保存。`);
      await refresh();
    } catch (value) {
      setKeysMessage(value instanceof Error ? value.message : String(value));
    } finally {
      setKeysBusy(false);
    }
  }, [refresh]);

  const installRuntime = useCallback(async (target: RuntimeInstallTarget) => {
    try {
      setRuntimeProvision(await fineSubRuntime.install(target));
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  }, []);

  const removeRuntime = useCallback(async () => {
    try {
      setRuntimeProvision(await fineSubRuntime.removeAll());
      await refresh();
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  }, [refresh]);

  const cancelRuntimeInstall = useCallback(async () => {
    try {
      setRuntimeProvision(await fineSubRuntime.cancel());
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
    }
  }, []);

  const installPython = useCallback(async () => {
    setSection("runtime");
    setMessage("正在准备 Python，以启用本地服务。");
    try {
      setPythonBootstrap(await fineSubRuntime.installPython());
    } catch (value) {
      setMessage(value instanceof Error ? value.message : String(value));
      setPythonBootstrap(await fineSubRuntime.pythonStatus().catch(() => null));
    }
  }, []);

  useEffect(() => {
    if (sidecar?.running || pythonBootstrap?.state !== "missing" || !pythonBootstrap.supported || pythonBootstrapStarted.current) return;
    pythonBootstrapStarted.current = true;
    void installPython();
  }, [installPython, pythonBootstrap, sidecar?.running]);

  const runtimeProvisionMissing = runtimeProvision === null;

  // The sidecar is started before the window opens, so the first refresh can
  // land while it is still handshaking, and a start that failed outright never
  // recovers on its own. A transient failure on the follow-up reads leaves the
  // same hole with the sidecar up but the provision state unknown. All of them
  // used to strand the runtime page on permanently disabled buttons until the
  // user found 「重新检查」. Python installation drives its own polling.
  useEffect(() => {
    if (pythonBootstrap?.state === "running") return;
    if (sidecar?.running && !runtimeProvisionMissing) return;
    const timer = window.setInterval(() => void refresh({ silent: true }), sidecarRetryIntervalMs);
    return () => window.clearInterval(timer);
  }, [pythonBootstrap?.state, refresh, runtimeProvisionMissing, sidecar?.running]);

  useEffect(() => {
    if (pythonBootstrap?.state !== "running") return;
    const timer = window.setInterval(() => {
      void fineSubRuntime.pythonStatus().then((status) => {
        setPythonBootstrap(status);
        setMessage(status.message);
        if (status.state === "ready") void refresh();
      }).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pythonBootstrap?.state, refresh]);

  const runtimeReady = capabilities?.runtime?.ready === true;
  const issues = capabilities?.runtime?.issues ?? [];
  const title = section === "library"
    ? "媒体库"
    : section === "tasks"
      ? "处理任务"
      : section === "runtime"
        ? "运行环境"
        : section === "plugins"
          ? "插件管理"
          : section === "plugin"
            ? activeMountedPlugin?.tool.title ?? "插件工具"
        : section === "account"
          ? "云端账户"
          : section === "adminKeys"
            ? "Key 管理"
            : section === "about"
              ? "关于"
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
      <UpdateOverlay update={selfUpdate} />
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
        <span className="nav-label tools-label">工具</span>
        <nav className="plugin-tools-nav" aria-label="插件工具">
          {pluginTools.map((item) => (
            <button
              className={section === "plugin" && activePluginTool?.pluginId === item.pluginId && activePluginTool.toolId === item.tool.id ? "active" : ""}
              key={`${item.pluginId}:${item.tool.id}`}
              title={`${item.pluginName} · ${item.tool.title}`}
              onClick={() => openPluginTool(item.pluginId, item.tool.id)}
            >
              <PluginToolIcon />
              <span className="nav-text">{item.tool.title}</span>
            </button>
          ))}
          <button className={section === "plugins" ? "active" : ""} title="插件管理" onClick={() => setSection("plugins")}>
            <NavIcon kind="plugins" />
            <span className="nav-text">插件管理</span>
            {plugins.length > 0 && <small className="nav-count">{plugins.length}</small>}
          </button>
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
          <button className={section === "about" ? "active" : ""} title="关于" onClick={() => setSection("about")}>
            <NavIcon kind="about" />
            <span className="nav-text">关于</span>
          </button>
        </nav>
        <div className="sidebar-spacer" />
        <section className="sidebar-provider" aria-label="执行位置">
          <div className="sidebar-provider-status">
            <span className={`status-dot ${executionMode === "cloud" ? "online" : sidecar?.running ? "local" : ""}`} />
            <div>
              <strong>{executionMode === "cloud" ? "Nonoka Cloud" : "本地运行"}</strong>
              <small>{executionMode === "cloud" ? cloudSession?.admin ? "管理员 · 不限次" : `剩余 ${cloudSession?.remaining ?? "—"} 次` : runtimeReady ? "引擎已就绪" : "需要检查环境"}</small>
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
        {/* Windows caption strip: empty on purpose so the whole band stays a
            non-client drag region — anything interactive placed here would be
            swallowed by the native hit test. */}
        <div className="workspace-titlebar" aria-hidden="true" />
        <div className={`workspace-scroll${section === "plugin" ? " plugin-workspace-scroll" : ""}`}>
          <header className="topbar">
            <div>
              <h1>{title}</h1>
            </div>
            {section === "library" && <label className="library-search"><span>⌕</span><input type="search" placeholder="搜索标题或文件名" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
            <div className="topbar-actions">
              <UpdateButton update={selfUpdate} />
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

          {!runtimeReady && (section === "library" || section === "tasks") && <section className={`runtime-banner warning`}>
            <div className="runtime-symbol">!</div>
            <div className="runtime-copy">
              <span className="eyebrow">本地执行环境</span>
              <h2>
                {loadState === "loading"
                  ? "正在连接本地服务"
                  : "需要完成运行时配置"}
              </h2>
              <p>
                {message || issues[0]?.message || "正在读取 capabilities…"}
              </p>
            </div>
            <button onClick={() => setSection("runtime")}>查看详情 →</button>
          </section>}

          {section === "library" && (
            <LibraryPage
              items={libraryItems}
              visibleItems={visibleItems}
              thumbnails={thumbnails}
              cloudThumbnails={cloudThumbnails}
              adoptingMedia={adoptingMedia}
              adoptingCloud={adoptingCloud}
              remoteByFingerprint={remoteByFingerprint}
              filter={libraryFilter}
              filterCounts={filterCounts}
              sort={sortMode}
              view={viewMode}
              busy={libraryBusy}
              message={libraryMessage.text}
              messageTone={libraryMessage.tone}
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
              onCancel={cancelActiveTask}
              onRename={renameMedia}
              onRemove={removeMedia}
              onEditCloud={editCloudEntry}
              onDeleteCloud={deleteCloudMedia}
              onRelink={relinkMedia}
              onDismissMessage={() => setLibraryMessage(noNotice)}
            />
          )}

          {section === "tasks" && (
            <TasksPage
              tasks={taskHistory}
              media={media}
              activeCount={activeTaskCount}
              message={taskHistoryMessage}
              pipelineError={pipeline.error?.message}
              logSource={localTaskLogs}
              onNavigateLibrary={() => setSection("library")}
              onOpenEditor={(entry) => void openEditor(entry)}
              onClearTasks={clearTaskHistory}
              onTaskAction={actOnHistoryTask}
              onDismissMessage={() => setTaskHistoryMessage("")}
            />
          )}

          {section === "plugins" && (
            <PluginManagerPage
              plugins={plugins}
              busy={pluginBusy}
              message={pluginMessage}
              onInstall={installPlugin}
              onToggle={togglePlugin}
              onUninstall={uninstallPlugin}
              onOpenTool={openPluginTool}
              onDismissMessage={() => setPluginMessage("")}
            />
          )}

          {section === "plugin" && activeMountedPlugin && (
            <PluginPageHost
              mounted={activeMountedPlugin}
              theme={theme}
              onOpenManager={() => setSection("plugins")}
              onOpenLibrary={() => setSection("library")}
              onOpenRuntime={() => setSection("runtime")}
            />
          )}

          {section === "runtime" && (
            <RuntimePage capabilities={capabilities} message={message} provision={runtimeProvision} pythonBootstrap={pythonBootstrap} ready={runtimeReady} sidecar={sidecar} onCancelInstall={cancelRuntimeInstall} onInstall={installRuntime} onInstallPython={installPython} onRemoveAll={removeRuntime} />
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
              onDismissMessage={() => setKeysMessage("")}
              onDismissCacheMessage={() => setCacheMessage("")}
            />
          )}

          {section === "adminKeys" && cloudSession?.admin && <AdminKeysPage />}

          {section === "account" && (
            <AccountPage session={cloudSession} media={cloudMedia} loginKey={loginKey} busy={accountBusy} message={accountMessage} onLoginKeyChange={setLoginKey} onLogin={login} onLogout={logout} onDismissMessage={() => setAccountMessage("")} />
          )}

          {section === "about" && <AboutPage />}
        </div>
      </main>

      {dialog && <MediaDialog dialog={dialog} busy={dialogBusy} setDialog={setDialog} onSubmit={submitDialog} />}
      {transcriptionMedia && <TranscriptionDialog
        entry={transcriptionMedia}
        initialMode={executionMode}
        localReady={runtimeReady}
        localCapabilities={capabilities}
        cloudCapabilities={cloudCapabilities}
        settings={settings}
        localIssue={message || issues[0]?.message}
        cloudAuthenticated={cloudSession?.authenticated === true}
        cloudRemaining={cloudSession?.remaining ?? undefined}
        busy={transcriptionBusy}
        error={transcriptionError}
        onClose={() => { if (!transcriptionBusy) setTranscriptionMedia(null); }}
        onOpenRuntime={() => { setTranscriptionMedia(null); setSection("runtime"); }}
        onOpenAccount={() => { setTranscriptionMedia(null); setSection("account"); }}
        onOpenKeys={() => { setTranscriptionMedia(null); setSection("keys"); }}
        onStart={confirmTranscription}
      />}
    </div>
  );
}
