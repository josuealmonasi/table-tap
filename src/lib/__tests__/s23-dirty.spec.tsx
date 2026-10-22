import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { field, resetHooks, state } from "./s23-test-helpers";
import type { CloseGuard } from "@/hooks/useDirtyClose";
const mocks = vi.hoisted(() => ({ context: null as CloseGuard | null, confirm: vi.fn(), keydown: null as ((event: { key: string; defaultPrevented?: boolean }) => void) | null }));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  ...await import("./s23-test-helpers").then(h => ({ useState: h.useState, useRef: h.useRef })),
  useContext: () => mocks.context, useLayoutEffect: (fn: () => void) => fn(), useEffect: (fn: () => void) => fn(),
}));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => mocks.confirm }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
import { DirtyCloseContext, useDirtyClose } from "@/hooks/useDirtyClose";
import { Modal } from "@/components/ui/Modal";
const close = vi.fn();
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.stubGlobal("React", React); resetHooks(); state.values = []; state.refs = [];
  mocks.context = null; mocks.keydown = null; vi.clearAllMocks();
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("window", { addEventListener: (_name: string, handler: typeof mocks.keydown) => { mocks.keydown = handler; } });
});
it("K19: the backdrop and Cancel share one discard ask and preserve a refused draft", async () => {
  const modal = Modal({ open: true, onClose: close, children: <span>Draft</span> });
  mocks.context = field(modal, "tag", DirtyCloseContext.Provider).value as CloseGuard;
  resetHooks(); state.refs = [];
  const cancel = useDirtyClose(true, close);
  let answer!: (ok: boolean) => void;
  mocks.confirm.mockImplementation(() => new Promise<boolean>(resolve => { answer = resolve; }));
  field(modal, "className", "tt-dialog-overlay ").onClick();
  cancel();
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  answer(false); await flush(); expect(close).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true); cancel(); await flush(); expect(close).toHaveBeenCalledTimes(1);
});
it("K19: a clean form closes without asking, and saving cannot be discarded", async () => {
  useDirtyClose(false, close)(); await flush();
  expect(close).toHaveBeenCalledOnce(); expect(mocks.confirm).not.toHaveBeenCalled();
  resetHooks(); useDirtyClose(true, close, true)(); await flush();
  expect(close).toHaveBeenCalledOnce(); expect(mocks.confirm).not.toHaveBeenCalled();
});

it("K19: Escape opens a discard ask; Escape again cancels without closing the draft", async () => {
  const modal = Modal({ open: true, onClose: close, children: <span>Draft</span> });
  mocks.context = field(modal, "tag", DirtyCloseContext.Provider).value as CloseGuard;
  resetHooks(); state.refs = [];
  useDirtyClose(true, close);
  let answer!: (ok: boolean) => void;
  mocks.confirm.mockImplementation(() => new Promise<boolean>(resolve => { answer = resolve; }));
  mocks.keydown!({ key: "Escape" });
  mocks.keydown!({ key: "Escape" });
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
  answer(false); await flush(); expect(close).not.toHaveBeenCalled();
});
