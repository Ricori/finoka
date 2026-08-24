import { useEffect } from 'react';
import { getStyleNames } from '../ass';
import { bindStyle, deleteTrack, renameTarget } from '../lib/edits';
import { docStore } from '../store/docStore';
import { closeTrackPop, modalStore } from '../store/uiStore';

/** 样式下拉：模板里没有的绑定值回落到「不导出」或首个样式，与旧版 fillStyleSelect 一致 */
function effStyle(value: string | null | undefined, allowNone: boolean) {
  const names = getStyleNames();
  const v = value || "";
  if (v && names.includes(v)) return v;
  if (!v && allowNone) return "";
  return allowNone ? "" : (names[0] || "");
}

function StyleSelect({ id, value, allowNone, onPick }: {
  id: string; value: string | null; allowNone: boolean; onPick(v: string): void;
}) {
  return (
    <select id={id} value={effStyle(value, allowNone)} onChange={e => onPick(e.target.value)}>
      {allowNone && <option value="">（不导出）</option>}
      {getStyleNames().map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}

/** 轨道设置弹层：改名 / 绑 ASS 样式 / 删轨。改动即时生效 */
export function TrackPopover() {
  const pop = modalStore.use(s => s.trkPop);
  docStore.use(s => s.version);   // 改名/换绑后要跟着刷新
  const { tracks, trackMeta } = docStore.get();

  // 点弹层外关闭
  useEffect(() => {
    if (!pop) return;
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("#trk-pop") || el?.closest(".lbtn.gear")) return;
      closeTrackPop();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [pop]);

  if (!pop) return <div className="trk-pop" id="trk-pop" hidden />;

  const { target, rect } = pop;
  const isTrack = target.kind === "track";
  const tr = isTrack ? tracks[target.ti] : null;
  if (isTrack && !tr) return <div className="trk-pop" id="trk-pop" hidden />;

  const isJa = !isTrack && target.kind === "default" && target.lang === "ja";
  const name = isTrack ? (tr!.name || "") : (trackMeta?.name || "默认轨");
  const styleTarget = isTrack ? { kind: "track" as const, ti: target.ti } : { kind: "default" as const };

  return (
    <div className="trk-pop" id="trk-pop" style={{
      left: Math.min(rect.left, window.innerWidth - 236) + "px",
      bottom: (window.innerHeight - rect.top + 6) + "px",
      top: "auto",
    }}>
      <div id="tp-name-wrap">
        <label>轨道名称</label>
        {/* 不能在 onChange 里 trim：受控输入会把刚敲下的空格立刻吃掉，名字里就打不出空格 */}
        <input id="tp-name" spellCheck={false} value={name}
          onChange={e => renameTarget(e.target.value, styleTarget)}
          onBlur={e => renameTarget(e.target.value.trim(), styleTarget)} />
      </div>
      {/* 默认轨 lane：只绑当前语言的样式 */}
      <div style={{ display: isTrack || isJa ? undefined : "none" }}>
        <label>原文样式</label>
        <StyleSelect id="tp-style-ja" allowNone={isTrack}
          value={isTrack ? tr!.ja.style : (trackMeta?.ja.style ?? null)}
          onPick={v => bindStyle("ja", v, styleTarget)} />
      </div>
      <div style={{ display: isTrack || !isJa ? undefined : "none" }}>
        <label>译文样式</label>
        <StyleSelect id="tp-style-zh" allowNone={isTrack}
          value={isTrack ? tr!.zh.style : (trackMeta?.zh.style ?? null)}
          onPick={v => bindStyle("zh", v, styleTarget)} />
      </div>
      <button className="btn danger" id="tp-delete" style={{ display: isTrack ? undefined : "none" }}
        onClick={() => { closeTrackPop(); if (isTrack) void deleteTrack(target.ti); }}>删除轨道</button>
    </div>
  );
}
