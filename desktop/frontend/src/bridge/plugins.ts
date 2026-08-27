import { Service as PluginService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/plugins/index.js";
import type {
  DownloadedMedia,
  ExportedArtifact,
  InstalledPlugin,
  MediaSummary,
  ToolContribution,
} from "../../bindings/github.com/Ricori/finoka/desktop/internal/plugins/models.js";

export type { DownloadedMedia, ExportedArtifact, InstalledPlugin, MediaSummary, ToolContribution };

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
