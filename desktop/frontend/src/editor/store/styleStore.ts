import { createStore } from '../../home/lib/createStore';
import { assStyles } from '../../bridge/assStyles';
import { DEFAULT_STYLE_SHEET } from '../constants';
import { setStyleSheet } from '../ass';

/**
 * 本机 ASS 样式表
 * 写死的 JP/CN 不在这份文本里，合并发生在 ass.ts::setStyleSheet。
 */
interface StyleState {
  /** 用户那份 [V4+ Styles] 原文（可以只有 Style 行，也可以是整段甚至整个 ASS 头） */
  text: string;
  /** 是否已从磁盘读过一次：没读到就别拿内存里的种子去覆盖磁盘 */
  loaded: boolean;
}

export const styleStore = createStore<StyleState>({ text: DEFAULT_STYLE_SHEET, loaded: false });

function apply(text: string) {
  styleStore.set({ text });
  setStyleSheet(text);
}

/** 打开编辑器时装载一次。读不到（首次运行 / 文件坏了）就用种子，但不落盘 */
export async function loadStyleSheet() {
  let stored = "";
  try { stored = (await assStyles.get()) || ""; } catch { stored = ""; }
  apply(stored.trim() ? stored : DEFAULT_STYLE_SHEET);
  styleStore.set({ loaded: true });
}

/** 保存并立刻生效。落盘失败就抛给调用方，内存里那份保持磁盘上的状态 */
export async function saveStyleSheet(text: string) {
  apply(await assStyles.save(text));
}
