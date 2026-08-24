import type { MediaEntry } from "../bridge/library.ts";
import type { Theme } from "../app/types.ts";
import { EditorApp } from "./App.tsx";
import { configureEditorSession } from "./session.ts";
import "./Editor.css";

interface EditorProps {
  media: MediaEntry;
  theme: Theme;
  onToggleTheme(): void;
  onClose(): void;
  onSaved(): void;
}

export function Editor({ media, theme, onToggleTheme, onClose, onSaved }: EditorProps) {
  configureEditorSession({ media, theme, toggleTheme: onToggleTheme, onClose, onSaved });
  return (
    <section className="professional-editor" aria-label="字幕编辑器">
      <EditorApp />
    </section>
  );
}
