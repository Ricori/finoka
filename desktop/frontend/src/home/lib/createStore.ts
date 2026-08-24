import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface Store<T extends object> {
  /** 读当前值。同步、永远最新，供跨 await 的编排函数使用 */
  get(): T;
  /** 浅合并写入；所有字段引用都没变则不通知订阅者 */
  set(patch: Partial<T> | ((state: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
  /** 组件订阅一个切片。selector 返回新对象时必须给 isEqual（如 shallowEqual），否则会无限重渲染 */
  use<S>(selector: (state: T) => S, isEqual?: (a: S, b: S) => boolean): S;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };

  const set: Store<T>['set'] = patch => {
    const next = (typeof patch === 'function' ? patch(state) : patch) as Partial<T>;
    let changed = false;
    for (const k in next) if (!Object.is(state[k], next[k as keyof T])) { changed = true; break; }
    if (!changed) return;
    state = { ...state, ...next };
    // 复制一份再遍历：监听器里可能又触发订阅/退订
    for (const listener of [...listeners]) listener();
  };

  function use<S>(selector: (state: T) => S, isEqual: (a: S, b: S) => boolean = Object.is): S {
    // selector 通常是内联箭头函数（每次渲染新引用），不能按函数身份缓存；改成每次重算、
    // 再用 isEqual 把结果折回上一次的引用——getSnapshot 必须对「没实质变化」返回同一引用
    const selectorRef = useRef(selector);
    const isEqualRef = useRef(isEqual);
    selectorRef.current = selector;
    isEqualRef.current = isEqual;

    const cache = useRef<{ value: S } | null>(null);
    const getSnapshot = useCallback(() => {
      const value = selectorRef.current(state);
      const last = cache.current;
      if (last && isEqualRef.current(last.value, value)) return last.value;
      cache.current = { value };
      return value;
    }, []);

    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }

  return { get, set, subscribe, use };
}

/** 选出多个字段时用它当 isEqual，免得每次渲染的新对象字面量被判定为「变了」 */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  const ka = Object.keys(a) as (keyof T)[];
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every(k => Object.is(a[k], b[k]));
}
