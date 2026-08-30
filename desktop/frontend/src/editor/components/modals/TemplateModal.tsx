import { useEffect, useState } from 'react';
import { docStore } from '../../store/docStore';
import { modalStore } from '../../store/uiStore';

/** ASS 样式模板：全站共享一份，仅管理员可改（后端 PUT 也会 403 兜底） */
export function TemplateModal() {
  const open = modalStore.use(s => s.tplOpen);
  const assTemplate = docStore.use(s => s.assTemplate);
  const [text, setText] = useState("");

  useEffect(() => { if (open) setText(assTemplate); }, [open, assTemplate]);

  const close = () => modalStore.set({ tplOpen: false });

  return (
    <div className="modal" id="tpl-modal" hidden={!open}
      onClick={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="box">
        <button className="x-close" id="tpl-close" title="关闭" onClick={close}>✕</button>
        <h3 id="tpl-title">ASS 样式模板</h3>
        <div className="hint">Finoka 的预览与导出共用这份内置模板。轨道通过样式名绑定其中的 Style；
          可粘贴完整 ASS 头（含 [Script Info]）或仅 [V4+ Styles] 段。</div>
        <textarea id="tpl-text" spellCheck={false} wrap="off" readOnly value={text} />
        <div className="foot" id="tpl-foot"><button className="btn" onClick={close}>关闭</button></div>
      </div>
    </div>
  );
}
