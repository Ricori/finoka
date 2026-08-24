import { getVid } from '../session';
import { docStore } from '../store/docStore';
import { toast } from '../store/uiStore';
import { viewStore } from '../store/viewStore';
import { errText } from '../utils';
import { buildAss, buildClipAss, missingStyles } from './assBuild';
import { mediaLibrary } from '../../bridge/library.ts';

/**
 * 导出 ASS。整片和切片都在本地拼（buildAss 与服务端 edit_export_ass 逐字一致，也正是
 * 预览用的那份），不走服务端：导出算的就是屏幕上这份文档，离线也能出，
 * 也不必先把改动 PUT 上去等一轮往返。
 */
export async function exportAss() {
  try {
    const { title } = docStore.get();
    const v = viewStore.get();
    // 服务端那份遇到模板里没有的样式名直接 400；本地 outputLines 只会悄悄少一条线，
    // 所以在这里补上同一道闸，别出坏文件
    const miss = missingStyles();
    if (miss.length) {
      toast("导出失败：样式模板里不存在 " + miss.join("、") + "，请在轨道设置里改绑");
      return;
    }
    let name = (title || getVid()).replace(/\.[a-z0-9]{2,4}$/i, "") || getVid();
    let content: string;
    if (v.curClip) {
      content = buildClipAss(v.t0, v.t1);
      name += " - " + v.curClip.name;
    } else {
      content = buildAss();
    }
    const path = await mediaLibrary.saveSubtitle(name + ".ass", content);
    if (!path) return;
    toast("已导出 " + path + " · 点此打开所在文件夹",
      true, () => void mediaLibrary.revealInFolder(path), 5000, true);
  } catch (e) {
    toast("导出失败：" + errText(e));
  }
}
