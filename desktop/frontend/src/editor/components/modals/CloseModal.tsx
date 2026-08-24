import { useEffect, useRef, useState } from 'react';
import { cancelClose, saveAndClose } from '../../lib/closeFlow';
import { backHome } from '../../session';
import { modalStore } from '../../store/uiStore';

/**
 * 关闭确认：用页内弹窗而不是原生模态——原生模态会冻结整个应用，
 * 关掉之后窗口还要重新抢回前台焦点，用户会觉得点什么都没反应。
 */
export function CloseModal() {
  const open = modalStore.use(s => s.closeOpen);
  const [saving, setSaving] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) saveRef.current?.focus(); }, [open]);

  return (
    <div className="modal" id="close-modal" hidden={!open}>
      <div className="box confirm">
        <h3>有未保存的改动</h3>
        <div className="hint" id="close-msg">字幕有未保存的改动，关闭编辑器前要先保存吗？</div>
        <div className="foot">
          <button className="btn" id="close-cancel" onClick={cancelClose}>取消</button>
          <button className="btn" id="close-discard" onClick={() => backHome()}>不保存，直接关闭</button>
          <button className="btn primary" id="close-save" ref={saveRef} disabled={saving}
            onClick={async () => {
              setSaving(true);
              try { await saveAndClose(); } finally { setSaving(false); }
            }}>保存并关闭</button>
        </div>
      </div>
    </div>
  );
}
