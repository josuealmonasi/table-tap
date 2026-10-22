import type { ReactNode, ReactElement } from "react";
function isValidElement<P>(value: ReactNode): value is ReactElement<P> {
  return typeof value === "object" && value !== null && "props" in value && "type" in value;
}

export const state = {
  cursor: 0, values: [] as unknown[], refCursor: 0, refs: [] as { current: unknown }[],
};
export function resetHooks(): void { state.cursor = 0; state.refCursor = 0; }
export function useState(initial: unknown) {
  const slot = state.cursor++;
  if (!(slot in state.values)) state.values[slot] = typeof initial === "function" ? initial() : initial;
  return [state.values[slot], (next: unknown) => {
    state.values[slot] = typeof next === "function" ? next(state.values[slot]) : next;
  }];
}
export function useRef(initial: unknown) { return state.refs[state.refCursor++] ??= { current: initial }; }
export interface Props {
  [key: string]: unknown;
  children?: ReactNode;
  onChange: (event: { target: { value: string } }) => void;
  onClick: () => Promise<void> | void;
  onSubmit: (event: { preventDefault: () => void }) => Promise<void> | void;
}
export function nodes(root: ReactNode): Props[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Props>(root)) return [];
  return [{ ...root.props, tag: root.type }, ...nodes(root.props.children)];
}
export function field(root: ReactNode, key: string, value: unknown): Props {
  const found = nodes(root).find(p => p[key] === value);
  if (!found) throw new Error(`Missing ${key}=${String(value)}`);
  return found;
}
export const event = { preventDefault() {} };
