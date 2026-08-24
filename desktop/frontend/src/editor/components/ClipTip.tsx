import { useLayoutEffect, useRef } from 'react';
import { modalStore } from '../store/uiStore';
import { fmtDur, fmtHMS } from '../utils';

/** 切片标记上的悬浮说明。跟着鼠标走，贴右边缘时往左收 */
export function ClipTip() {
  const tip = modalStore.use(s => s.clipTip);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const r = el.getBoundingClientRect();
    el.style.left = Math.min(tip.x + 12, innerWidth - r.width - 6) + "px";
    el.style.top = (tip.y + 16) + "px";
  }, [tip]);

  if (!tip) return <div className="clip-tip" hidden />;
  const c = tip.clip;
  return (
    <div className="clip-tip" ref={ref}>
      <b>{c.name}</b>
      <span>{`　${fmtHMS(c.t0)} → ${fmtHMS(c.t1)}　共 ${fmtDur(c.t1 - c.t0)}`}</span>
      <div style={{ color: "var(--faint)" }}>双击进入 · 拖两端改起止 · 右键更多</div>
    </div>
  );
}
