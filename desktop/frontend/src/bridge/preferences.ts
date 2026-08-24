import { Service as PreferencesService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/preferences/index.js";
import type { State as PreferencesState } from "../../bindings/github.com/Ricori/finoka/desktop/internal/preferences/models.js";

export type { PreferencesState };

export const desktopPreferences = {
  get: PreferencesService.Get,
  save: PreferencesService.Save,
};
