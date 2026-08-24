import { Service as ProviderService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/provider/index.js";
import type { EditDocument } from "../documents/types.ts";


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
};
