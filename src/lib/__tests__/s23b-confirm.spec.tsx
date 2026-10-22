import React, { type ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { contexts, harness } from "./s23b-hook-harness";
import { field, type Props } from "./s23-test-helpers";
import type { CloseGuard } from "@/hooks/useDirtyClose";

vi.mock("react", async original => ({ ...await original<typeof React>(),
  ...await import("./s23b-hook-harness").then(h => ({ useState: h.useState, useRef: h.useRef, useContext: h.useContext, useEffect: h.useEffect, useLayoutEffect: h.useEffect })),
  useCallback: (fn: unknown) => fn,
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
import { ConfirmProvider, useConfirm } from "@/components/ui/ConfirmDialog";
import { DirtyCloseContext, useDirtyClose } from "@/hooks/useDirtyClose";

const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
const listeners = new Map<string, Set<(e: KeyboardEvent) => void>>();
let active: unknown;
function button() { const el = { focus: () => { active = el; }, isConnected: true }; return el; }
beforeEach(() => {
  vi.stubGlobal("React", React); contexts.clear(); listeners.clear(); active = null;
  vi.stubGlobal("document", { get activeElement() { return active; } });
  vi.stubGlobal("window", {
    addEventListener: (key: string, fn: (e: KeyboardEvent) => void) => { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key)!.add(fn); },
    removeEventListener: (key: string, fn: (e: KeyboardEvent) => void) => listeners.get(key)?.delete(fn),
  });
});
function Provider() {
  const frame = harness();
  const render = () => {
    const root = frame.render(() => ConfirmProvider({ children: null }));
    contexts.set(root.type, root.props.value);
    frame.effects();
    return root;
  };
  render();
  return { ...frame, render, confirm: useConfirm() };
}
it("3 / Q3: replacing the MX$80→MX$100 discard ask settles the guard and permits another close", async () => {
  const p = Provider(); const form = harness(); const close = vi.fn();
  const guard: CloseGuard = { current: null };
  contexts.set(DirtyCloseContext, guard);
  const cancel = form.render(() => useDirtyClose(true, close)); form.effects();
  cancel();
  const second = p.confirm({ title: "Delete dish" });
  const root = p.render();
  const dialog = (root.props.children as ReactElement<Props>[])[1];
  (dialog.props.onResolve as (answer: boolean) => void)(false);
  await expect(second).resolves.toBe(false); await flush();
  expect(guard.confirming).toBe(false); expect(close).not.toHaveBeenCalled();
  cancel(); expect(guard.confirming).toBe(true);
  const next = (p.render().props.children as ReactElement<Props>[])[1];
  (next.props.onResolve as (answer: boolean) => void)(true);
  await flush(); expect(close).toHaveBeenCalledOnce();
});
it("3 / Q3: saving started during the question cannot be discarded", async () => {
  const p = Provider(); const form = harness(); const close = vi.fn();
  contexts.set(DirtyCloseContext, { current: null });
  const cancel = form.render(() => useDirtyClose(true, close, false)); form.effects(); cancel();
  form.render(() => useDirtyClose(true, close, true)); form.effects();
  const dialog = (p.render().props.children as ReactElement<Props>[])[1];
  (dialog.props.onResolve as (answer: boolean) => void)(true);
  await flush(); expect(close).not.toHaveBeenCalled();
});
it("3 / Q3: provider unmount cancels its pending answer", async () => {
  const p = Provider(); let answer: boolean | undefined;
  void p.confirm({ title: "Discard?" }).then(value => { answer = value; });
  p.unmount(); await flush(); expect(answer).toBe(false);
});
it("3 / Q3: unmounting the form while the question is open never closes its replacement", async () => {
  const p = Provider(); const form = harness(); const close = vi.fn();
  contexts.set(DirtyCloseContext, { current: null });
  const cancel = form.render(() => useDirtyClose(true, close)); form.effects(); cancel(); form.unmount();
  const dialog = (p.render().props.children as ReactElement<Props>[])[1];
  (dialog.props.onResolve as (answer: boolean) => void)(true);
  await flush(); expect(close).not.toHaveBeenCalled();
});
it("3 / Q3: the actual confirmation traps Tab, Shift+Tab and outside focus, then restores focus", () => {
  const p = Provider(); const opener = button(); opener.focus();
  void p.confirm({ title: "Discard?" });
  const element = (p.render().props.children as ReactElement<Props>[])[1];
  const dialogFrame = harness();
  const Dialog = element.type as (props: Props) => ReactElement;
  const tree = dialogFrame.render(() => Dialog(element.props));
  const cancel = button(); const confirm = button();
  const dialog = { querySelectorAll: () => [cancel, confirm], contains: (el: unknown) => el === cancel || el === confirm };
  const node = field(tree, "role", "dialog");
  if (node.ref) (node.ref as { current: unknown }).current = dialog;
  dialogFrame.effects();
  function key(shiftKey: boolean) {
    const event = { key: "Tab", shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    for (const handler of listeners.get("keydown") ?? []) handler(event as unknown as KeyboardEvent);
    return event;
  }
  confirm.focus(); expect(key(false).preventDefault).toHaveBeenCalled(); expect(active).toBe(cancel);
  expect(key(true).preventDefault).toHaveBeenCalled(); expect(active).toBe(confirm);
  opener.focus(); key(false); expect(active).toBe(cancel);
  dialogFrame.unmount(); expect(active).toBe(opener);
});
it("3 / Q3: a destructive question opens on Cancel, any other on its action", () => {
  for (const [danger, expected] of [[true, "cancel"], [false, "confirm"]] as const) {
    const p = Provider();
    void p.confirm({ title: "Discard?", danger });
    const element = (p.render().props.children as ReactElement<Props>[])[1];
    const dialogFrame = harness();
    const Dialog = element.type as (props: Props) => ReactElement;
    const tree = dialogFrame.render(() => Dialog(element.props));
    const cancel = button(); const confirm = button();
    const dialog = { querySelectorAll: () => [cancel, confirm], contains: (el: unknown) => el === cancel || el === confirm };
    const node = field(tree, "role", "dialog");
    if (node.ref) (node.ref as { current: unknown }).current = dialog;
    dialogFrame.effects();
    expect(active).toBe(expected === "cancel" ? cancel : confirm);
    dialogFrame.unmount();
  }
});
