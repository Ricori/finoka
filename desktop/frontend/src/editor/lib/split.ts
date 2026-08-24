/**
 * 面板分隔条 / 行间手柄的通用拖动：按下时记住起始值，移动时把位移交给 apply。
 * 拖动中给元素挂 .drag（CSS 用它高亮），指针捕获保证拖出元素也不断。
 */
export function splitHandler(
  getStart: () => number,
  apply: (v0: number, dx: number, dy: number) => void,
) {
  return (e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    el.classList.add("drag");
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX, sy = e.clientY, v0 = getStart();
    const mv = (ev: PointerEvent) => apply(v0, ev.clientX - sx, ev.clientY - sy);
    // pointercancel 也要收尾：只听 pointerup 的话，拖拽被系统打断后 .drag 和 move 监听都会留着
    const done = () => {
      el.removeEventListener("pointermove", mv);
      el.removeEventListener("pointerup", done);
      el.removeEventListener("pointercancel", done);
      el.classList.remove("drag");
    };
    el.addEventListener("pointermove", mv);
    el.addEventListener("pointerup", done);
    el.addEventListener("pointercancel", done);
  };
}
