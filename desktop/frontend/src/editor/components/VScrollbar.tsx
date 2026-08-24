import { useLayoutEffect, useRef, useState } from 'react';
import { shallowEqual } from '../../home/lib/createStore';
import { SB } from '../constants';
import { setScrollTop, tlStore, vMax } from '../store/tlStore';

/**
 * 自绘纵向滚动条。原生的会从容器顶端起、压在时间刻度上，所以纵向关掉了原生条
 * （.tl-scroll 的 overflow-y:hidden），只留 scrollTop 编程滚动，这里补一条。
 */
export function VScrollbar() {
  const { top, h, scrollH } = tlStore.use(
    s => ({ top: s.top, h: s.h, scrollH: s.scrollH }), shallowEqual);
  const barRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [trackH, setTrackH] = useState(0);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setTrackH(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // 轨道栏本身一直在（只切 hidden），装一次就够——每次渲染都重装 observer
    // 会在拖分隔条时把每一帧都拖慢
  }, []);

  const max = Math.max(0, scrollH - h);
  const th = scrollH > 0 ? Math.max(24, Math.round(trackH * h / scrollH)) : 24;
  const thumbTop = max > 0 ? Math.round((trackH - th) * (top / max)) : 0;

  // 拖滑块滚动；点空槽把滑块中心挪过去
  const onThumbDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const thumb = thumbRef.current, bar = barRef.current;
    if (!thumb || !bar) return;
    thumb.classList.add("drag");
    bar.classList.add("show");   // 拖动中鼠标滑出轨道区也不淡出
    thumb.setPointerCapture(e.pointerId);
    const y0 = e.clientY, top0 = thumb.offsetTop, room = bar.clientHeight - thumb.offsetHeight;
    const mv = (ev: PointerEvent) => {
      if (room <= 0) return;
      const nt = Math.min(Math.max(top0 + ev.clientY - y0, 0), room);
      setScrollTop(vMax() * nt / room);
    };
    const done = () => {
      thumb.removeEventListener("pointermove", mv);
      thumb.removeEventListener("pointerup", done);
      thumb.removeEventListener("pointercancel", done);
      thumb.classList.remove("drag");
      bar.classList.remove("show");
    };
    thumb.addEventListener("pointermove", mv);
    thumb.addEventListener("pointerup", done);
    thumb.addEventListener("pointercancel", done);
  };

  const onBarDown = (e: React.PointerEvent) => {
    if (e.target !== barRef.current) return;
    const bar = barRef.current, thumb = thumbRef.current;
    if (!bar || !thumb) return;
    const room = bar.clientHeight - thumb.offsetHeight;
    if (room <= 0) return;
    const y = e.clientY - bar.getBoundingClientRect().top - thumb.offsetHeight / 2;
    setScrollTop(vMax() * Math.min(Math.max(y / room, 0), 1));
  };

  return (
    <div className="vscroll" id="vscroll" ref={barRef} hidden={max <= 0}
      style={{ bottom: SB + "px" }} onPointerDown={onBarDown}>
      <div className="vthumb" id="vthumb" ref={thumbRef}
        title="拖动纵向滚动轨道（也可 Alt+滚轮）"
        style={{ height: th + "px", top: thumbTop + "px" }}
        onPointerDown={onThumbDown} />
    </div>
  );
}
