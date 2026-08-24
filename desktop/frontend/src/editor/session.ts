import type { MediaEntry } from "../bridge/library.ts";
import type { EditDocument } from "../documents/types.ts";
import type { Theme } from "../app/types.ts";
import { createStore } from "../home/lib/createStore.ts";

interface EditorSession {
  media: MediaEntry | null;
  document: EditDocument | null;
  onClose: () => void;
  onSaved: () => void;
  toggleTheme: () => void;
}

const noop = () => undefined;
let leaving = false;

export const editorSession = createStore<EditorSession & { theme: Theme }>({
  media: null,
  document: null,
  theme: "dark",
  onClose: noop,
  onSaved: noop,
  toggleTheme: noop,
});

export function configureEditorSession(options: {
  media: MediaEntry;
  theme: Theme;
  onClose: () => void;
  onSaved: () => void;
  toggleTheme: () => void;
}) {
  leaving = false;
  const current = editorSession.get();
  editorSession.set({
    ...options,
    document: current.media?.id === options.media.id ? current.document : null,
  });
}

export const getVid = () => editorSession.get().media?.id ?? "";
export const getMedia = () => editorSession.get().media;
export const getLoadedDocument = () => editorSession.get().document;
export const setLoadedDocument = (document: EditDocument) => editorSession.set({ document });
export const notifySaved = () => editorSession.get().onSaved();
export const isSmokeMode = () => false;
export const isLeaving = () => leaving;

export function backHome() {
  leaving = true;
  editorSession.get().onClose();
}

export async function initSession(): Promise<boolean> {
  return !!getVid();
}

export function reportBootError(error: unknown) {
  console.error("Finoka editor:", error);
}
