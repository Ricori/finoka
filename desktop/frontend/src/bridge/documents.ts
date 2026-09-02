import { Service as ProviderService } from "../../bindings/github.com/Ricori/nonoka-x/desktop/internal/provider/index.js";
import type { EditDocument } from "../documents/types.ts";
import type { TaskAxis } from "../providers/types.ts";


export interface Peaks {
  per_sec: number;
  duration: number;
  peaks: number[];
}

export const documents = {
  async read(videoID: string): Promise<EditDocument> {
    return await ProviderService.Document(videoID) as unknown as EditDocument;
  },
  async peaks(videoID: string): Promise<Peaks | null> {
    try {
      return await ProviderService.DocumentPeaks(videoID) as unknown as Peaks;
    } catch {
      return null;
    }
  },
  async save(videoID: string, document: EditDocument): Promise<EditDocument> {
    return await ProviderService.SaveDocument(videoID, document as unknown as Record<string, unknown>) as unknown as EditDocument;
  },
  /** 记下这次任务要落在哪条轴上；传 null 清掉，免得上一次导入的轴影响下一次转写。 */
  async setAxis(videoID: string, axis: TaskAxis | null): Promise<void> {
    await ProviderService.SetDocumentAxis(videoID, axis as unknown as Record<string, unknown> | null);
  },
  /** 中文轴 / 双语轴：不跑任务，直接落成可编辑文档。 */
  async importAxis(input: {
    videoID: string; axis: TaskAxis; title: string; sourcePath: string;
    fingerprint?: string; duration?: number;
  }): Promise<EditDocument> {
    return await ProviderService.ImportDocument({
      video_id: input.videoID,
      axis: input.axis as unknown as Record<string, unknown>,
      title: input.title,
      source_path: input.sourcePath,
      fingerprint: input.fingerprint ?? "",
      duration: input.duration ?? 0,
    }) as unknown as EditDocument;
  },
};
