import { useEffect, useRef } from 'react';
import { shallowEqual } from '../../home/lib/createStore';
import { deleteSegment, mergeNext, nudge, setSegText } from '../lib/edits';
import { armPending, commitPending, disarmPending } from '../lib/history';
import { seek } from '../lib/playback';
import { docStore } from '../store/docStore';
import { curSegs, select, selStore } from '../store/selectionStore';
import { toast } from '../store/uiStore';
import { fmtView, viewRange, viewStore } from '../store/viewStore';
import type { Lang } from '../types';

export function Inspector() {
  docStore.use(s => s.version);
  viewStore.use(s => s.curClip);
  const { sel, curTrack, selSize } = selStore.use(
    s => ({ sel: s.sel, curTrack: s.curTrack, selSize: s.selSet.size }), shallowEqual);
  const jaRef = useRef<HTMLTextAreaElement>(null);
  const zhRef = useRef<HTMLTextAreaElement>(null);

  const arr = curSegs();
  const s = arr[sel];

  // 焦点还在文本框时换了句：重建撤销起点，否则下一句的编辑会并进上一句那一步里
  useEffect(() => {
    const el = document.activeElement;
    if (el === jaRef.current || el === zhRef.current) armPending();
  }, [curTrack, sel]);

  /**
   * Ctrl/⌘+Enter：确认本句、跳到下一句，焦点留在同一个框里连着往下录。
   * Esc：退出文本框，焦点回到文档上（Space、↑↓ 这些全局快捷键随即恢复）
   */
  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, lang: Lang) {
    const el = lang === "ja" ? jaRef.current : zhRef.current;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      el?.blur();
      return;
    }
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const a = curSegs();
    if (!a.length) return;
    if (sel >= a.length - 1) { toast("已是最后一句"); return; }
    const i = sel + 1;
    select(i);
    seek(a[i].t0 + 0.01);
    // 换句后重新渲染完再抢焦点，光标落到句末接着改
    queueMicrotask(() => {
      const next = lang === "ja" ? jaRef.current : zhRef.current;
      next?.focus();
      next?.setSelectionRange(next.value.length, next.value.length);
    });
  }

  const onInput = (lang: Lang, v: string) => { commitPending(); setSegText(lang, v); };

  return (
    <div className="inspector">
      <div className="insp-head">
        <span className="label">当前字幕</span>
        <span className="idx" id="insp-idx">
          {s ? "#" + String(sel - viewRange(arr)[0] + 1).padStart(2, "0") : "--"}
        </span>
        <span className="spacer"></span>
        <span className="dur" id="insp-dur">{s ? (s.t1 - s.t0).toFixed(2) + "s" : ""}</span>
      </div>
      <div className="tc-row">
        <div className="tc-field">
          <label>入点 In</label>
          <div className="tc-ctrl">
            <button id="in-minus" title="-0.1s" onClick={() => nudge("in", -0.1)}>−</button>
            <span className="val" id="insp-in">{s ? fmtView(s.t0) : "--:--.--"}</span>
            <button id="in-plus" title="+0.1s" onClick={() => nudge("in", +0.1)}>+</button>
          </div>
        </div>
        <div className="tc-field">
          <label>出点 Out</label>
          <div className="tc-ctrl">
            <button id="out-minus" title="-0.1s" onClick={() => nudge("out", -0.1)}>−</button>
            <span className="val" id="insp-out">{s ? fmtView(s.t1) : "--:--.--"}</span>
            <button id="out-plus" title="+0.1s" onClick={() => nudge("out", +0.1)}>+</button>
          </div>
        </div>
      </div>
      <div className="textfield lang-ja">
        <label><i></i>日语原文</label>
        <textarea id="insp-ja" ref={jaRef} spellCheck={false} value={s ? s.ja : ""}
          onFocus={armPending} onBlur={disarmPending}
          onKeyDown={e => onKeyDown(e, "ja")}
          onChange={e => onInput("ja", e.target.value)} />
      </div>
      <div className="textfield lang-zh">
        <label><i></i>中文译文</label>
        <textarea id="insp-zh" ref={zhRef} spellCheck={false} value={s ? s.zh : ""}
          onFocus={armPending} onBlur={disarmPending}
          onKeyDown={e => onKeyDown(e, "zh")}
          onChange={e => onInput("zh", e.target.value)} />
      </div>
      <div className="insp-actions">
        <button className="btn" id="btn-merge" onClick={mergeNext}>⋈ 与下句合并</button>
        <button className="btn danger" id="btn-delete" onClick={deleteSegment}>
          {selSize > 1 ? "🗑 删除选中 " + selSize + " 句" : "🗑 删除本句"}
        </button>
      </div>
    </div>
  );
}
