import { getVid } from '../session';
import { docStore } from '../store/docStore';
import { toast } from '../store/uiStore';
import { viewStore } from '../store/viewStore';
import { errText } from '../utils';
import { buildSrt, type SrtLang } from './srtBuild';
import { mediaLibrary } from '../../bridge/library.ts';

/** 文件名后缀：双语不加，单语标出来，免得三份导出重名互相覆盖 */
const SUFFIX: Record<SrtLang, string> = { both: "", zh: " - 中文", ja: " - 日文" };

/**
 * 导出 SRT：所有未隐藏轨道按时间摊平成一条流（轨道与样式要保留就走 ASS）。
 * 与导出 ASS 一样整片、切片都在本地拼，不占服务端资源（对照基准见 srtBuild）。
 */
export async function exportSrt(lang: SrtLang) {
  try {
    const { title } = docStore.get();
    const v = viewStore.get();
    let name = (title || getVid()).replace(/\.[a-z0-9]{2,4}$/i, "") || getVid();
    let content: string;
    if (v.curClip) {
      content = buildSrt(lang, v.t0, v.t1);
      name += " - " + v.curClip.name;
    } else {
      content = buildSrt(lang);
    }
    // 关了翻译的产物导「仅译文」会是空文件，与其存一个空壳不如直接说清楚
    if (!content.trim()) { toast("没有可导出的内容：可见轨道里该语言全是空的"); return; }
    const path = await mediaLibrary.saveSubtitle(name + SUFFIX[lang] + ".srt", content);
    if (!path) return;
    toast("已导出 " + path + " · 点此打开所在文件夹",
      true, () => void mediaLibrary.revealInFolder(path), 5000, true);
  } catch (e) {
    toast("导出失败：" + errText(e));
  }
}
