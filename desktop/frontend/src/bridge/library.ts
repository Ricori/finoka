import { Service as LibraryService } from "../../bindings/github.com/Ricori/nonoka-x/desktop/internal/library/index.js";
import type {
  CacheStatus,
  Entry as MediaEntry,
  ImportResult,
} from "../../bindings/github.com/Ricori/nonoka-x/desktop/internal/library/models.js";

export type { CacheStatus, MediaEntry, ImportResult };

export interface EditorClip {
  id: string;
  name: string;
  t0: number;
  t1: number;
  createdAt: number;
}

export const mediaLibrary = {
  async list(): Promise<MediaEntry[]> {
    return (await LibraryService.List()) ?? [];
  },
  get: LibraryService.Get,
  pickAndImport: LibraryService.PickAndImport,
  importPaths: LibraryService.Import,
  thumbnail: LibraryService.ThumbnailDataURL,
  rename: LibraryService.Rename,
  deleteDocument: LibraryService.DeleteDocument,
  remove: LibraryService.Remove,
  relink: LibraryService.PickRelink,
  mediaURL: LibraryService.MediaURL,
  saveSubtitle: LibraryService.SaveSubtitle,
  exportVideo: LibraryService.ExportVideo,
  exportVideoRange: LibraryService.ExportVideoRange,
  cancelExport: LibraryService.CancelExport,
  transcodeToH264: LibraryService.TranscodeToH264,
  cancelTranscode: LibraryService.CancelTranscode,
  spectrogramTile: LibraryService.SpectrogramTile,
  revealInFolder: LibraryService.RevealInFolder,
  cacheStatus: LibraryService.CacheStatus,
  cacheMedia: LibraryService.CacheMedia,
  setCacheLimitGB: LibraryService.SetCacheLimitGB,
  clearVideoCache: LibraryService.ClearVideoCache,
  setActiveMedia: LibraryService.SetActiveMedia,
  async getClips(id: string): Promise<EditorClip[]> {
    return ((await LibraryService.GetClips(id)) ?? []) as EditorClip[];
  },
  setClips: LibraryService.SetClips,
};
