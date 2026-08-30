import { useEffect, useRef, useState } from 'react';
import { mergeStyleText, parseSheet } from '../../ass';
import { DEFAULT_STYLE_SHEET } from '../../constants';
import { refreshAll } from '../../lib/edits';
import { saveStyleSheet, styleStore } from '../../store/styleStore';
import { modalStore, toast } from '../../store/uiStore';
import { errText } from '../../utils';

/**
 * ASS 样式模板：整份存在本机（<数据目录>/styles.ass），谁都能随便改。
 * 写死的 JP/CN 不出现在这里——它们在 ass.ts::setStyleSheet 里跟这份合并，
 * 同名以这份为准，所以想改默认轨的样子，在这里写一条同名的 Style 就行。
 */
export function TemplateModal() {
  const open = modalStore.use(s => s.tplOpen);
  const stored = styleStore.use(s => s.text);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setText(stored); }, [open, stored]);

  const close = () => modalStore.set({ tplOpen: false });
  const dirty = text !== stored;

  async function save() {
    // 有内容却一条 Style 都读不出来，多半是粘错了东西：这时候存下去等于把样式表清空
    if (text.trim() && !parseSheet(text).order.length) {
      toast("没解析出任何 Style 行，请检查内容（可只保留 [V4+ Styles] 段）");
      return;
    }
    setBusy(true);
    try {
      await saveStyleSheet(text);
      refreshAll();          // 预览重解析整份 ASS，轨道标签的主题色也跟着换
      toast("样式模板已保存", false, null, undefined, true);
      close();
    } catch (e) {
      toast("样式模板保存失败：" + errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    try {
      const incoming = await readAssText(file);
      const { text: merged, added, updated } = mergeStyleText(text, incoming);
      if (!added.length && !updated.length) {
        toast("这个文件里没有 [V4+ Styles] 段，没什么可导入的");
        return;
      }
      setText(merged);
      const parts = [];
      if (added.length) parts.push("新增 " + added.join("、"));
      if (updated.length) parts.push("覆盖 " + updated.join("、"));
      toast("已导入：" + parts.join("；") + " · 点保存生效");
    } catch (e) {
      toast("读取 ASS 失败：" + errText(e));
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    // 编辑器全局的 Ctrl+S 在 TEXTAREA 里也生效，会把文档存了；弹窗开着时改存样式表
    else if (e.key.toLowerCase() === "s" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
    e.stopPropagation();
  };

  return (
    <div className="modal" id="tpl-modal" hidden={!open} onKeyDown={onKey}
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="box">
        <button className="x-close" id="tpl-close" title="关闭" onClick={close}>✕</button>
        <h3 id="tpl-title">样式模板</h3>
        <div className="hint">这里填写 ASS 样式，轨道通过样式名绑定其中的 Style。
          可只留 [V4+ Styles] 段，也可以粘完整 ASS 头（[Events] 段会被忽略）。</div>
        <textarea id="tpl-text" spellCheck={false} wrap="off" value={text}
          onChange={e => setText(e.target.value)} />
        <div className="foot" id="tpl-foot">
          <input ref={fileRef} type="file" accept=".ass,.ssa" hidden
            onChange={e => {
              const file = e.target.files?.[0];
              e.target.value = "";        // 同一个文件连选两次也要触发 change
              if (file) void importFile(file);
            }} />
          <button className="btn" id="tpl-import" style={{ marginRight: "auto" }}
            onClick={() => fileRef.current?.click()}>导入 ASS 样式…</button>
          <button className="btn" id="tpl-reset"
            onClick={() => setText(DEFAULT_STYLE_SHEET)}>恢复默认</button>
          <button className="btn" onClick={close}>取消</button>
          <button className="btn primary" id="tpl-save" disabled={busy || !dirty}
            onClick={() => void save()}>保存</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 读一个 ASS/SSA 文件。字幕文件的编码相当杂：先认 BOM，再按 UTF-8 严格解码，
 * 解不动才当 GBK——老片源的 .ass 十有八九是 GBK，静默解成乱码比报错更难查。
 */
async function readAssText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const body = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("gbk").decode(body);
  }
}
