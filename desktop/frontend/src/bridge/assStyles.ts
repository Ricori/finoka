import { Service as AssStylesService } from "../../bindings/github.com/Ricori/finoka/desktop/internal/assstyles/index.js";

/** 本机 ASS 样式表（<数据目录>/styles.ass）。空串 = 还没存过，由前端拿默认种子兜底 */
export const assStyles = {
  get: () => AssStylesService.Get() as Promise<string>,
  save: (text: string) => AssStylesService.Save(text) as Promise<string>,
};
