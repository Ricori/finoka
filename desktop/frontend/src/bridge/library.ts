import { Service as LibraryService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/library/index.js";
import type {
  CacheStatus,
  Entry as MediaEntry,
  ImportResult,
  LegacyMigrationResult,
  LegacyMigrationStatus,
} from "../../bindings/github.com/Ricori/finoka/desktop/internal/library/models.js";

export type { CacheStatus, MediaEntry, ImportResult, LegacyMigrationResult, LegacyMigrationStatus };

export const mediaLibrary = {
  async list(): Promise<MediaEntry[]> {
    return (await LibraryService.List()) ?? [];
  },
  pickAndImport: LibraryService.PickAndImport,
  importPaths: LibraryService.Import,
  thumbnail: LibraryService.ThumbnailDataURL,
  rename: LibraryService.Rename,
  remove: LibraryService.Remove,
  relink: LibraryService.PickRelink,
  mediaURL: LibraryService.MediaURL,
  saveSubtitle: LibraryService.SaveSubtitle,
  exportVideo: LibraryService.ExportVideo,
  revealInFolder: LibraryService.RevealInFolder,
  legacyMigrationStatus: LibraryService.LegacyMigrationStatus,
  migrateLegacyLibrary: LibraryService.MigrateLegacyLibrary,
  cacheStatus: LibraryService.CacheStatus,
  cacheMedia: LibraryService.CacheMedia,
  setCacheLimitGB: LibraryService.SetCacheLimitGB,
  clearVideoCache: LibraryService.ClearVideoCache,
  setActiveMedia: LibraryService.SetActiveMedia,
};
