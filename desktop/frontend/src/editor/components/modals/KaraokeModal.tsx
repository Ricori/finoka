import { useMemo, useState } from 'react';
import { karaokeGlyphs } from '../../../subtitles/karaoke.ts';
import {
  clearKaraoke, karaokeStateOf, karaokeSummary, karaokeTracks,
  readKaraokeFromWords, resetKaraokeOf, spreadKaraokeEvenly,
} from '../../lib/karaoke';
import { seek } from '../../lib/playback';
import { docStore, segsOf } from '../../store/docStore';
import { modalStore, toast } from '../../store/uiStore';
import type { Seg, Ti } from '../../types';

// K 轴面板：需要逐字时间的特效（目前是「K轴逐字粒子」）在这里拿到时间。
// 只管原文——译文的字数和原文对不上，逐字特效落在译文轴上一律按字数均分。

const ms = (seconds: number) => Math.round(seconds * 1000);

const STATE_LABEL = { ok: "已有", stale: "原文已改", none: "无" } as const;

function KaraokeRow({ seg, index }: { seg: Seg; index: number }) {
  const [open, setOpen] = useState(false);
  const state = karaokeStateOf(seg);
  const glyphs = karaokeGlyphs(seg.ja);
  return <div className={`kx-row kx-${state}`}>
    <button className="kx-row-head" onClick={() => setOpen(value => !value)}>
      <span className="kx-no">{index + 1}</span>
      <span className="kx-time">{seg.t0.toFixed(2)}</span>
      <span className="kx-text">{seg.ja || <i>（无原文）</i>}</span>
      <span className="kx-state">
        {STATE_LABEL[state]}{state === "ok" ? ` · ${seg.k!.length} 段 / ${glyphs.length} 字` : ""}
      </span>
    </button>
    {open && <div className="kx-detail">
      {state === "ok" ? <div className="kx-units">
        {seg.k!.map((unit, unitIndex) => <button key={unitIndex} className="kx-unit"
          title={`${unit.t0.toFixed(2)}s → ${unit.t1.toFixed(2)}s`}
          onClick={() => seek(unit.t0)}>
          <b>{unit.text}</b><i>{ms(unit.t1 - unit.t0)}</i>
        </button>)}
      </div> : <p className="kx-detail-hint">
        {state === "stale"
          ? "这句的 K 轴是按改动前的原文切的，字数对不上，逐字特效会忽略它。"
          : "这句还没有 K 轴，逐字特效会按字数均分整句时长。"}
      </p>}
      <button className="btn kx-reset" onClick={() => {
        if (resetKaraokeOf(seg)) toast("已重新生成这句的 K 轴");
      }}>重新生成这句</button>
    </div>}
  </div>;
}

export function KaraokeModal() {
  const open = modalStore.use(state => state.karaokeOpen);
  const version = docStore.use(state => state.version);
  const [ti, setTi] = useState<Ti>(-1);
  const [onlyMissing, setOnlyMissing] = useState(true);

  // 统计要扫全部句子，别放在渲染里按需算：轨道下拉每次重绘都会把整份文档过一遍
  const summaries = useMemo(() => karaokeTracks().map(karaokeSummary), [version]);
  const active = summaries.some(item => item.ti === ti) ? ti : -1;
  const summary = summaries.find(item => item.ti === active) ?? summaries[0];
  const segs = useMemo(() => segsOf(active).filter(seg => karaokeGlyphs(seg.ja).length), [active, version]);

  if (!open) return <div className="modal" hidden />;
  const close = () => modalStore.set({ karaokeOpen: false });

  const read = () => {
    const { applied, skipped } = readKaraokeFromWords(active, !onlyMissing);
    if (!applied) toast(skipped ? "这条轨的句子都没有可用的词级时间戳" : "没有需要更新的句子");
    else toast(`已从中间产物读出 ${applied} 句的逐字时间` + (skipped ? `，另有 ${skipped} 句没有词级时间戳` : ""),
      false, null, undefined, true);
  };
  const spread = () => {
    const { applied } = spreadKaraokeEvenly(active, onlyMissing);
    toast(applied ? `已按字数均分 ${applied} 句` : "没有需要更新的句子");
  };
  const clear = () => {
    const cleared = clearKaraoke(active);
    toast(cleared ? `已清除 ${cleared} 句的 K 轴` : "这条轨没有 K 轴");
  };

  return <div className="modal kx-modal" onMouseDown={event => {
    if (event.target === event.currentTarget) close();
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    event.stopPropagation();
  }}>
    <div className="box kx-box">
      <button className="x-close" title="关闭" onClick={close}>✕</button>
      <div className="fx-heading">
        <div><h3>K 轴（逐字时间）</h3>
          <p>逐字特效按 K 轴决定每个字什么时候出现。自动 K 轴按中间产物的词边界切段，
            一个词一段、整词一起亮；词内的字级时间转写并不提供，编出来反而更难看。</p></div>
      </div>

      <div className="kx-bar">
        <label>轨道
          <select value={active} onChange={event => setTi(Number(event.target.value))}>
            {summaries.map(item => <option key={item.ti} value={item.ti}>{item.name}</option>)}
          </select>
        </label>
        <label className="kx-check">
          <input type="checkbox" checked={onlyMissing}
            onChange={event => setOnlyMissing(event.target.checked)} />
          只处理还没有 K 轴的句子
        </label>
        <span className="kx-spacer" />
        <button className="btn primary" onClick={read}>自动 K 轴</button>
        <button className="btn" onClick={spread}>按字数均分</button>
        <button className="btn danger" onClick={clear}>清除本轨 K 轴</button>
      </div>

      <div className="kx-stats">
        <b>{summary.ok}</b> / {summary.total} 句已有可用 K 轴
        {summary.stale > 0 && <em> · {summary.stale} 句原文改过已失效</em>}
        {summary.readable > 0 && <em> · {summary.readable} 句可从中间产物读取</em>}
        {summary.readable === 0 && summary.ok < summary.total
          && <em> · 其余句子没有词级时间戳，只能按字数均分</em>}
      </div>

      <div className="kx-list">
        {segs.length
          ? segs.map((seg, index) => <KaraokeRow key={index} seg={seg} index={index} />)
          : <p className="kx-empty">这条轨没有带原文的句子。</p>}
      </div>

      <div className="fx-foot">
        <span>没有 K 轴的句子不会导致特效消失，只是退回按字数均分。</span>
        <button className="btn primary" onClick={close}>完成</button>
      </div>
    </div>
  </div>;
}
