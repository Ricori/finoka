import { shallowEqual } from '../../home/lib/createStore';
import { toastStore } from '../store/uiStore';

export function Toast() {
  const s = toastStore.use(x => x, shallowEqual);
  const cls = "toast" + (s.show ? " show" : "") + (s.sticky ? " sticky" : "") + (s.ok ? " ok" : "");
  return (
    <div className={cls} id="toast" onClick={() => s.onClick?.()}>{s.msg}</div>
  );
}
