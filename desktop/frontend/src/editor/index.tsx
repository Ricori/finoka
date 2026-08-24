import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Events } from "@wailsio/runtime";
import type { Theme } from "../app/types.ts";
import { mediaLibrary } from "../bridge/library.ts";
import type { MediaEntry } from "../bridge/library.ts";
import { desktopPreferences } from "../bridge/preferences.ts";
import { installWindowsTitlebar } from "../bridge/window.ts";
import { desktopWindows } from "../bridge/windows.ts";
import { Editor } from "./Editor.tsx";
import { requestClose } from "./lib/closeFlow.ts";
import "./Editor.css";

function EditorWindow() {
  const [media, setMedia] = useState<MediaEntry | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    Promise.all([mediaLibrary.get(id), desktopPreferences.get()])
      .then(([entry, preferences]) => {
        const nextTheme = preferences.theme === "light" ? "light" : "dark";
        // 在挂载编辑器前同步落主题，隐藏窗口首次显示时就已经是最终配色。
        document.body.classList.toggle("light", nextTheme === "light");
        const color = nextTheme === "light" ? "#f7f5ef" : "#171b2a";
        document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", color);
        setMedia(entry);
        setTheme(nextTheme);
      })
      .catch((value) => setError(value instanceof Error ? value.message : String(value)));
  }, []);

  // 初始化失败时也要揭示已经提交的错误页，避免留下一个永久隐藏的原生窗口。
  useEffect(() => {
    if (!error) return;
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    void Events.Emit("editor:ready", id);
  }, [error]);

  useEffect(() => {
    document.body.classList.toggle("light", theme === "light");
    const color = theme === "light" ? "#f7f5ef" : "#171b2a";
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", color);
  }, [theme]);

  useEffect(() => Events.On("editor:request-close", () => requestClose()), []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      void desktopPreferences.save({ theme: next }).catch(() => undefined);
      return next;
    });
  }, []);

  if (error) {
    return (
      <main className="editor-window-error">
        <strong>编辑器无法打开</strong>
        <span>{error}</span>
        <button type="button" onClick={() => void desktopWindows.closeEditor()}>关闭编辑器</button>
      </main>
    );
  }
  if (!media) return <div className="editor-window-loading">正在打开字幕编辑器…</div>;

  return (
    <Editor
      media={media}
      theme={theme}
      onToggleTheme={toggleTheme}
      onClose={() => void desktopWindows.closeEditor()}
      onSaved={() => undefined}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Finoka editor root element is missing");
createRoot(root).render(<EditorWindow />);
void installWindowsTitlebar();
