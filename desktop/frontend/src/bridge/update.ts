import { Events } from "@wailsio/runtime";
import { Service as UpdateService } from "../../bindings/github.com/Ricori/nonoka-x/desktop/internal/selfupdate/index.js";
import type { ReleaseNotes, Status as UpdateStatus } from "../../bindings/github.com/Ricori/nonoka-x/desktop/internal/selfupdate/models.js";

export type { ReleaseNotes, UpdateStatus };

/** Emitted once per session when a build has finished staging. */
export interface UpdateReady {
  version: string;
}

const on = <T>(name: string, handler: (payload: T) => void) =>
  Events.On(name, (event) => handler(event.data as T));

export const desktopUpdate = {
  status: () => UpdateService.GetStatus(),
  currentVersion: () => UpdateService.CurrentVersion(),
  install: () => UpdateService.InstallUpdate(),
  consumeReleaseNotes: () => UpdateService.ConsumeReleaseNotes(),
  onStatus: (handler: (status: UpdateStatus) => void) => on<UpdateStatus>("update:status", handler),
  onReady: (handler: (ready: UpdateReady) => void) => on<UpdateReady>("update:ready", handler),
};
