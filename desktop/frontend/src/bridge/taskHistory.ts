import { Service as TaskHistoryService } from "../../bindings/github.com/Ricori/nonoka-x/desktop/internal/taskhistory/index.js";

/** Processing history lives in its own task-history.json, separate from the
    user settings in preferences.json. */
export const desktopTaskHistory = {
  get: TaskHistoryService.Get,
  save: TaskHistoryService.Save,
};
