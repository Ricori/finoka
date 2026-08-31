import { Service as PluginService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/plugins/index.js";
import type {
  DownloadedMedia,
  DownloaderSettings,
  ExportedArtifact,
  InstalledPlugin,
  MediaSummary,
  ToolContribution,
} from "../../bindings/github.com/Ricori/finoka/desktop/internal/plugins/models.js";
import type { EditDocument } from "../documents/types.ts";

export type { DownloadedMedia, DownloaderSettings, ExportedArtifact, InstalledPlugin, MediaSummary, ToolContribution };

export interface MountedPluginTool {
  pluginId: string;
  pluginName: string;
  tool: ToolContribution;
}

export const desktopPlugins = {
  async list(): Promise<InstalledPlugin[]> {
    return (await PluginService.List()) ?? [];
  },
  install: PluginService.PickAndInstall,
  setEnabled: PluginService.SetEnabled,
  uninstall: PluginService.Uninstall,
  pageHTML: PluginService.PageHTML,
  async mediaList(pluginId: string): Promise<MediaSummary[]> {
    return (await PluginService.MediaList(pluginId)) ?? [];
  },
  exportAudio: PluginService.ExportAudio,
  runYTDLP: PluginService.RunYTDLP,
  cancelDownload: PluginService.CancelDownload,
  clearDownloadLog: PluginService.ClearDownloadLog,
  async downloadLog(pluginId: string): Promise<string[]> {
    return (await PluginService.DownloadLogLines(pluginId)) ?? [];
  },
  // Cookie 只写不读：宿主只回报「配没配、几条」，不会把凭据交回沙箱页面。
  downloaderSettings: PluginService.LoadDownloaderSettings,
  saveCookies: PluginService.SaveCookies,
  clearCookies: PluginService.ClearCookies,
  async document(pluginId: string, mediaId: string): Promise<EditDocument> {
    return await PluginService.Document(pluginId, mediaId) as unknown as EditDocument;
  },
  async saveDocument(pluginId: string, mediaId: string, document: unknown): Promise<EditDocument> {
    return await PluginService.SaveDocument(pluginId, mediaId, document as Record<string, unknown>) as unknown as EditDocument;
  },
  saveSubtitleFile: PluginService.SaveSubtitleFile,
  exportVideo: PluginService.ExportVideo,
};

export function mountedTools(plugins: InstalledPlugin[]): MountedPluginTool[] {
  return plugins
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) => (plugin.contributes.tools ?? []).map((tool) => ({
      pluginId: plugin.id,
      pluginName: plugin.name,
      tool,
    })))
    .sort((left, right) => (left.tool.order ?? 0) - (right.tool.order ?? 0)
      || left.tool.title.localeCompare(right.tool.title, "zh-CN"));
}
