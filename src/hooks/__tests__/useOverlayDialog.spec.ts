import React from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { harness } from "@/lib/__tests__/s23b-hook-harness";

vi.mock("react", async original => ({ ...await original<typeof React>(),
  ...await import("@/lib/__tests__/s23b-hook-harness").then(h => ({ useRef: h.useRef, useEffect: h.useEffect, useLayoutEffect: h.useEffect })),
}));
import { useOverlayDialog } from "@/hooks/useOverlayDialog";

interface FakeElement { focus: () => void; isConnected: boolean; offsetParent: object | null; field: boolean }
let active: unknown;
let open: unknown[];
const listeners = new Set<(e: KeyboardEvent) => void>();
function element(field = false): FakeElement {
  const el: FakeElement = { focus: () => { active = el; }, isConnected: true, offsetParent: {}, field };
  return el;
}
function sheetWith(items: FakeElement[]) {
  const sheet = {
    ...element(),
    contains: (el: unknown) => el === sheet || items.includes(el as FakeElement),
    // The hook asks for the first button or link, never a field.
    querySelector: () => items.find(el => !el.field) ?? null,
    querySelectorAll: () => items,
  };
  return sheet;
}
function press(key: string, shiftKey = false, defaultPrevented = false) {
  const event = { key, shiftKey, defaultPrevented, preventDefault: vi.fn() };
  for (const fn of [...listeners]) fn(event as unknown as KeyboardEvent);
  return event;
}
function openSheet(sheet: ReturnType<typeof sheetWith>, onClose = vi.fn()) {
  const frame = harness();
  frame.render(() => useOverlayDialog({ current: sheet as unknown as HTMLElement }, onClose));
  frame.effects();
  return { frame, onClose };
}
beforeEach(() => {
  vi.stubGlobal("React", React); listeners.clear(); active = null; open = [];
  vi.stubGlobal("document", {
    get activeElement() { return active; },
    querySelectorAll: () => open,
  });
  vi.stubGlobal("window", {
    addEventListener: (_: string, fn: (e: KeyboardEvent) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (e: KeyboardEvent) => void) => listeners.delete(fn),
  });
});

it("opening moves focus to the sheet's first button, and closing gives it back", () => {
  const opener = element(); opener.focus();
  const back = element(); const send = element();
  const sheet = sheetWith([back, send]); open = [sheet];
  const { frame } = openSheet(sheet);
  expect(active).toBe(back);
  frame.unmount();
  expect(active).toBe(opener);
});

it("a field that took focus as the sheet opened keeps it (the till's name box)", () => {
  const name = element(true); const send = element();
  const sheet = sheetWith([name, send]); open = [sheet];
  name.focus();
  openSheet(sheet);
  expect(active).toBe(name);
});

it("Escape closes the topmost sheet", () => {
  const sheet = sheetWith([element()]); open = [sheet];
  const { onClose } = openSheet(sheet);
  press("Escape");
  expect(onClose).toHaveBeenCalledOnce();
});

it("Escape leaves the cart alone while the coupon dialog sits above it", () => {
  const sheet = sheetWith([element()]); const coupon = {}; open = [sheet, coupon];
  const { onClose } = openSheet(sheet);
  press("Escape");
  expect(onClose).not.toHaveBeenCalled();
  open = [sheet];
  press("Escape", false, true);
  expect(onClose).not.toHaveBeenCalled();
});

it("Tab and Shift+Tab wrap inside the sheet, and focus behind it is pulled back in", () => {
  const back = element(); const send = element();
  const sheet = sheetWith([back, send]); open = [sheet];
  openSheet(sheet);
  send.focus(); expect(press("Tab").preventDefault).toHaveBeenCalled(); expect(active).toBe(back);
  expect(press("Tab", true).preventDefault).toHaveBeenCalled(); expect(active).toBe(send);
  element().focus(); press("Tab"); expect(active).toBe(back);
});

it("every full-screen sheet goes through DetailOverlay, which says it is a dialog", () => {
  // The till's charge and the order tracker each built the overlay by hand,
  // and neither said a dialog had opened. A new hand-built one would repeat it.
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== "__tests__") walk(path); }
      else if (path.endsWith(".tsx")) files.push(path);
    }
  };
  walk("src");
  const byHand = files.filter(f => !f.endsWith("DetailOverlay.tsx") && /className="tt-detail-overlay"/.test(readFileSync(f, "utf8")));
  expect(byHand).toEqual([]);
  const overlay = readFileSync("src/components/customer/DetailOverlay.tsx", "utf8");
  for (const attr of ['role="dialog"', 'aria-modal="true"', "aria-label={label}", "useOverlayDialog("]) {
    expect(overlay).toContain(attr);
  }
});
