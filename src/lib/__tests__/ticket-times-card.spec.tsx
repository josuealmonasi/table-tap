// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
import TicketTimesCard from "@/components/dashboard/settings/TicketTimesCard";

// Leaving "warn" starts the save; the fields used to be disabled while it ran,
// so tabbing into "late" threw the cursor out to the page (pnpm dialogs).
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("keeps the cursor in «late» while the save started by leaving «warn» is in flight", async () => {
  let finish!: (ok: boolean) => void;
  const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  await act(async () => root.render(<TicketTimesCard warn={10} late={20} save={save} />));
  const [warn, late] = [...host.querySelectorAll("input")];
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    warn.focus();
    setValue.call(warn, "12");
    warn.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { late.focus(); });
  expect(save).toHaveBeenCalledWith({ ticket_warn_minutes: 12, ticket_late_minutes: 20 });
  expect(late.disabled).toBe(false);
  expect(document.activeElement).toBe(late);
  await act(async () => finish(true));
});
