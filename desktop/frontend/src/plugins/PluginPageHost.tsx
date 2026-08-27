import { useEffect, useRef, useState } from "react";
import { desktopPlugins } from "../bridge/plugins.ts";
import type { MountedPluginTool } from "../bridge/plugins.ts";
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

  useEffect(() => {
    const receive = (event: MessageEvent<PluginMessage>) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== "finoka-plugin" || event.data.apiVersion !== 1) return;
      if (event.data.method === "ui.ready" || event.data.method === "host.getInfo") {
        frame.current?.contentWindow?.postMessage({
          source: "finoka-host",
          apiVersion: 1,
          id: event.data.id,
          method: "host.info",
          result: {
            theme,
            pluginId: mounted.pluginId,
            toolId: mounted.tool.id,
            locale: navigator.language,
          },
        }, "*");
      }
      if (event.data.method === "ui.openPluginManager") onOpenManager();
      if (event.data.method === "ui.openLibrary") onOpenLibrary();
      if (event.data.method === "ui.openRuntime") onOpenRuntime();
      if (event.data.method === "media.list") {
        void desktopPlugins.mediaList(mounted.pluginId)
          .then((result) => respond(frame.current, event.data.id, result))
          .catch((value) => respond(frame.current, event.data.id, undefined, value));
      }
      if (event.data.method === "ffmpeg.extractAudio") {
        const params = isRecord(event.data.params) ? event.data.params : {};
        const mediaId = typeof params.mediaId === "string" ? params.mediaId : "";
        const format = typeof params.format === "string" ? params.format : "";
        void desktopPlugins.exportAudio(mounted.pluginId, mediaId, format)
          .then((result) => respond(frame.current, event.data.id, result))
          .catch((value) => respond(frame.current, event.data.id, undefined, value));
      }
      if (event.data.method === "tools.runYtDLP") {
        const params = isRecord(event.data.params) ? event.data.params : {};
        const url = typeof params.url === "string" ? params.url : "";
        const args = Array.isArray(params.args) && params.args.every((item) => typeof item === "string") ? params.args : [];
        void desktopPlugins.runYTDLP(mounted.pluginId, url, args)
          .then((result) => respond(frame.current, event.data.id, result))
          .catch((value) => respond(frame.current, event.data.id, undefined, value));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [mounted.pluginId, mounted.tool.id, onOpenLibrary, onOpenManager, onOpenRuntime, theme]);

  useEffect(() => {
    if (!html) return;
    frame.current?.contentWindow?.postMessage({
      source: "finoka-host",
      apiVersion: 1,
      method: "host.info",
      result: {
        theme,
        pluginId: mounted.pluginId,
        toolId: mounted.tool.id,
        locale: navigator.language,
      },
    }, "*");
  }, [html, mounted.pluginId, mounted.tool.id, theme]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function respond(frame: HTMLIFrameElement | null, id: unknown, result?: unknown, error?: unknown) {
  frame?.contentWindow?.postMessage({
    source: "finoka-host",
    apiVersion: 1,
    id,
    method: "rpc.result",
    result,
    error: error === undefined ? undefined : error instanceof Error ? error.message : String(error),
  }, "*");
}
