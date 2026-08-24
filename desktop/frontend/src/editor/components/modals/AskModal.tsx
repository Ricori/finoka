import { useEffect, useRef } from 'react';
import { askStore, closeAsk, setAskValue } from '../../store/uiStore';

/**
 * 通用输入/确认弹窗：window.prompt() 在这类壳里直接抛错（不受支持），
 * confirm() 虽然能用但会冻结整个应用，所以两者都走这个页内弹窗。
 */
export function AskModal() {
  const dialog = askStore.use(s => s.dialog);
  const open = !!dialog;
  const isInput = dialog?.value !== null && dialog?.value !== undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    if (isInput) { inputRef.current?.focus(); inputRef.current?.select(); }
    else okRef.current?.focus();
  }, [open, isInput]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); closeAsk(true); }
    else if (e.key === "Escape") { e.preventDefault(); closeAsk(false); }
    e.stopPropagation();   // 别让编辑器的全局快捷键接管
  };

  return (
    <div className="modal" id="ask-modal" hidden={!open} onKeyDown={onKey}>
      <div className="box confirm">
        <h3 id="ask-title">{dialog?.title}</h3>
        <div className="hint" id="ask-hint" hidden={!dialog?.hint}>{dialog?.hint}</div>
        <input id="ask-input" ref={inputRef} spellCheck={false} hidden={!isInput}
          value={isInput ? dialog!.value! : ""} onChange={e => setAskValue(e.target.value)} />
        <div className="foot">
          <button className="btn" id="ask-cancel" onClick={() => closeAsk(false)}>取消</button>
          <button ref={okRef} id="ask-ok"
            className={"btn" + (dialog?.danger ? " danger" : " primary")}
            onClick={() => closeAsk(true)}>{dialog?.okLabel || "确定"}</button>
        </div>
      </div>
    </div>
  );
}
