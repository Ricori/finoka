import { useEffect } from "react";
import { Events } from "@wailsio/runtime";
import { AUTOSAVE_MS } from "../constants";
import { isLeaving, reportBootError } from "../session";
import { expJob, exportStore } from "../store/exportStore";
import { flushLayout } from "../store/layoutStore";
import { clipsDirty, saveStore, startAutosave } from "../store/saveStore";

export function useDesktopEvents() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportBootError(event.error || event.message);
    const onRejection = (event: PromiseRejectionEvent) => reportBootError(event.reason);
    addEventListener("error", onError);
    addEventListener("unhandledrejection", onRejection);
    return () => {
      removeEventListener("error", onError);
      removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushLayout();
      if (isLeaving()) return;
      const state = saveStore.get();
      if ((state.dirty && !state.conflicted) || clipsDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const onPageHide = () => flushLayout();
    addEventListener("beforeunload", onBeforeUnload);
    addEventListener("pagehide", onPageHide);
    return () => {
      removeEventListener("beforeunload", onBeforeUnload);
      removeEventListener("pagehide", onPageHide);
      flushLayout();
    };
  }, []);

  useEffect(() => startAutosave(AUTOSAVE_MS), []);

  useEffect(() => Events.On("media:progress", (event) => {
    const progress = event.data as { id?: string; stage?: string; done?: number; total?: number };
    if (progress.stage !== "export" || progress.id !== expJob() || !progress.total) return;
    const pct = Math.max(0, Math.min(100, Math.round((progress.done || 0) / progress.total * 100)));
    exportStore.set({ pct });
  }), []);
}
