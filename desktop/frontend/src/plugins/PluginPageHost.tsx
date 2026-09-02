import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Events } from "@wailsio/runtime";
import { assStyles } from "../bridge/assStyles.ts";
import { desktopPlugins } from "../bridge/plugins.ts";
import type { MountedPluginTool } from "../bridge/plugins.ts";
import { documentAss, documentSrt } from "../subtitles/document.ts";
import type { SubtitleRange } from "../subtitles/document.ts";
import type { SrtLang } from "../subtitles/build.ts";
import "./plugins.css";

interface PluginPageHostProps {
  mounted: MountedPluginTool;
  theme: "dark" | "light";
  onOpenManager: () => void;
  onOpenLibrary: () => void;
  onOpenRuntime: () => void;
}

interface PluginMessage {
  source?: unknown;
  apiVersion?: unknown;
  method?: unknown;
  id?: unknown;
  params?: unknown;
}

type Params = Record<string, unknown>;

export function PluginPageHost({ mounted, theme, onOpenManager, onOpenLibrary, onOpenRuntime }: PluginPageHostProps) {
  const [html, setHTML] = useState("");
  const [error, setError] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    setHTML("");
    setError("");
    void desktopPlugins.pageHTML(mounted.pluginId, mounted.tool.id).then((page) => {
      if (alive) setHTML(page);
    }).catch((value) => {
      if (alive) setError(value instanceof Error ? value.message : String(value));
    });
    return () => { alive = false; };
  }, [mounted.pluginId, mounted.tool.id]);

  const info = useCallback(() => ({
    theme,
    pluginId: mounted.pluginId,
    toolId: mounted.tool.id,
    locale: navigator.language,
  }), [mounted.pluginId, mounted.tool.id, theme]);

  /**
   * 插件能调用的宿主方法。每个带返回值的方法都落到 Go 的同名能力上，权限在那边校验：
   * 这里只做参数整形，不做「这个插件能不能」的判断。字幕文本由宿主用编辑器那条
   * 拼装管线（src/subtitles）现拼，所以插件拿到的 ASS 与编辑器导出的逐字相同。
   */
  const handlers = useMemo<Record<string, (params: Params) => Promise<unknown>>>(() => {
    const plugin = mounted.pluginId;
    const readDocument = (params: Params) => desktopPlugins.document(plugin, text(params.mediaId));
    const range = (params: Params): SubtitleRange | undefined => {
      const t0 = Number(params.t0), t1 = Number(params.t1);
      return Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 ? { t0, t1 } : undefined;
    };
    return {
      "media.list": () => desktopPlugins.mediaList(plugin),
      "ffmpeg.extractAudio": (params) => desktopPlugins.exportAudio(plugin, text(params.mediaId), text(params.format)),
      "tools.runYtDLP": (params) => desktopPlugins.runYTDLP(plugin, text(params.url), strings(params.args)),
      "downloader.settings": () => desktopPlugins.downloaderSettings(plugin),
      "downloader.saveCookies": (params) => desktopPlugins.saveCookies(plugin, text(params.content)),
      "downloader.clearCookies": () => desktopPlugins.clearCookies(plugin),
      "downloader.cancel": () => desktopPlugins.cancelDownload(plugin),
      "downloader.log": () => desktopPlugins.downloadLog(plugin),
      "downloader.clearLog": () => desktopPlugins.clearDownloadLog(plugin),
      "document.read": readDocument,
      "document.save": (params) => desktopPlugins.saveDocument(plugin, text(params.mediaId), params.document),
      "subtitle.ass": async (params) => {
        const [document, styles] = await Promise.all([readDocument(params), storedStyles()]);
        return { text: documentAss(document, styles, range(params)), rev: document.rev };
      },
      "subtitle.srt": async (params) => {
        const language = params.lang === "ja" || params.lang === "zh" ? params.lang : "both";
        const document = await readDocument(params);
        return { text: documentSrt(document, language as SrtLang, range(params)), rev: document.rev };
      },
      "subtitle.save": (params) => desktopPlugins.saveSubtitleFile(plugin, text(params.fileName), text(params.content)),
      "media.exportVideo": (params) => {
        const span = range(params);
        const height = Number(params.height);
        return desktopPlugins.exportVideo(
          plugin,
          text(params.mediaId),
          text(params.fileName),
          text(params.ass),
          span?.t0 ?? 0,
          span?.t1 ?? 0,
          Number.isFinite(height) ? Math.trunc(height) : 0,
        );
      },
    };
  }, [mounted.pluginId]);

  useEffect(() => {
    const receive = (event: MessageEvent<PluginMessage>) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "nonoka-plugin" || event.data.apiVersion !== 1) return;
      const method = typeof event.data.method === "string" ? event.data.method : "";
      const id = event.data.id;
      if (method === "ui.ready" || method === "host.getInfo") {
        post(frame.current, { id, method: "host.info", result: info() });
      }
      if (method === "ui.openPluginManager") onOpenManager();
      if (method === "ui.openLibrary") onOpenLibrary();
      if (method === "ui.openRuntime") onOpenRuntime();
      const handler = handlers[method];
      if (!handler) return;
      void handler(isRecord(event.data.params) ? event.data.params : {})
        .then((result) => respond(frame.current, id, result))
        .catch((value) => respond(frame.current, id, undefined, value));
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [handlers, info, onOpenLibrary, onOpenManager, onOpenRuntime]);

  // 压制导出和视频下载都要跑几分钟，插件页面自己看不到 Wails 事件；转发进度它才能画进度条。
  // 两条都走 media:progress，用 stage 区分，宿主这里只有一个转发器。
  useEffect(() => Events.On("media:progress", (event) => {
    const progress = event.data as { id?: string; stage?: string; done?: number; total?: number };
    const method = PROGRESS_METHODS[progress?.stage ?? ""];
    if (!method || !progress.total) return;
    post(frame.current, {
      method,
      result: { done: progress.done ?? 0, total: progress.total },
    });
  }), []);

  // 下载日志：几分钟的任务光有进度条说明不了它卡在哪一步，把 yt-dlp 的输出转发过去。
  useEffect(() => Events.On("plugins:download-log", (event) => {
    const entry = event.data as { line?: string };
    if (!entry?.line) return;
    post(frame.current, { method: "download.log", result: { line: entry.line } });
  }), []);

  useEffect(() => {
    if (!html) return;
    post(frame.current, { method: "host.info", result: info() });
  }, [html, info]);

  if (error) {
    return (
      <section className="plugin-page-state panel">
        <span className="plugin-state-symbol">!</span>
        <h2>插件页面无法加载</h2>
        <p>{error}</p>
        <button className="quiet-button" onClick={onOpenManager}>打开插件管理</button>
      </section>
    );
  }
  if (!html) return <section className="plugin-page-state panel"><span className="plugin-loader" /><p>正在加载 {mounted.tool.title}…</p></section>;

  return (
    <section className="plugin-page-shell" aria-label={`${mounted.pluginName} · ${mounted.tool.title}`}>
      <iframe
        ref={frame}
        className="plugin-page-frame"
        title={`${mounted.pluginName} · ${mounted.tool.title}`}
        sandbox="allow-scripts"
        srcDoc={html}
      />
    </section>
  );
}

/** Wails 进度事件的 stage → 插件页面收到的方法名 */
const PROGRESS_METHODS: Record<string, string> = {
  export: "media.progress",
  download: "download.progress",
  // 下载结束也走这条：真正的结果由 rpc.result 回给发起的那个 frame，而用户切走
  // 页面后那个 frame 已经不在了，没有这条收尾事件，重新挂载的页面会一直停在进度条上。
  "download-end": "download.finished",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const strings = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : [];

/** 本机 ASS 样式表原文；读不到就让拼装管线用种子兜底，与编辑器同口径 */
const storedStyles = async (): Promise<string> => {
  try {
    return (await assStyles.get()) || "";
  } catch {
    return "";
  }
};

function post(frame: HTMLIFrameElement | null, message: { id?: unknown; method: string; result?: unknown; error?: unknown }) {
  frame?.contentWindow?.postMessage({ source: "nonoka-host", apiVersion: 1, ...message }, "*");
}

function respond(frame: HTMLIFrameElement | null, id: unknown, result?: unknown, error?: unknown) {
  post(frame, {
    id,
    method: "rpc.result",
    result,
    error: error === undefined ? undefined : error instanceof Error ? error.message : String(error),
  });
}
