import type { DependencyList } from "react";

interface Effect { deps?: DependencyList; cleanup?: () => void }
interface Frame {
  slots: unknown[];
  cursor: number;
  effects: Effect[];
  effectCursor: number;
  pending: (() => void)[];
}
let current: Frame;
export const contexts = new Map<unknown, unknown>();
export function useContext(context: unknown): unknown { return contexts.get(context); }
export function useState(initial: unknown) {
  const frame = current;
  const slot = frame.cursor++;
  if (!(slot in frame.slots)) frame.slots[slot] = typeof initial === "function" ? initial() : initial;
  return [frame.slots[slot], (value: unknown) => {
    frame.slots[slot] = typeof value === "function" ? value(frame.slots[slot]) : value;
  }];
}
export function useRef(initial: unknown) {
  const slot = current.cursor++;
  return current.slots[slot] ??= { current: initial };
}
export function useEffect(fn: () => void | (() => void), deps?: DependencyList): void {
  const frame = current;
  const slot = frame.effectCursor++;
  const previous = frame.effects[slot];
  if (deps && previous?.deps && deps.every((dep, i) => Object.is(dep, previous.deps![i]))) return;
  frame.pending.push(() => {
    previous?.cleanup?.();
    frame.effects[slot] = { deps, cleanup: fn() || undefined };
  });
}
/** Runs the real component's callbacks and lifecycle without a browser or database. */
export function harness() {
  const frame: Frame = { slots: [], cursor: 0, effects: [], effectCursor: 0, pending: [] };
  return {
    render<T>(fn: () => T): T {
      current = frame; frame.cursor = 0; frame.effectCursor = 0;
      return fn();
    },
    effects() { for (const effect of frame.pending.splice(0)) effect(); },
    unmount() { for (const effect of frame.effects) effect.cleanup?.(); },
  };
}
