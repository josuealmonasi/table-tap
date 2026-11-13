import * as React from "react";
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { pendingHarness } from "./pending-ui-harness";

// Full review, screens #1: held cash from any till blocks the close, so the
// till says so before the cashier blind-counts, not after.
const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, locale: "en" as "en" | "es" }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/dashboard/cash/CashMovementDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/cash/CloseShiftDialog", () => ({ default: () => null }));
import PosCashDrawer from "@/components/dashboard/pos/PosCashDrawer";

beforeEach(() => { vi.stubGlobal("React", React); state.ui = pendingHarness(); state.locale = "en"; });

it.each(["en", "es"] as const)("disables the close and says a manager must review the held sales (%s)", locale => {
  state.locale = locale;
  const t = (key: string, vars?: Record<string, number>) => translate(messagesFor(locale), key, vars);
  state.ui.render(() => <PosCashDrawer shiftOpen shiftId="shift" currency="MXN" heldCash={3} />);
  const close = state.ui.all("button").find(b => b.text === t("shift.close"))!;
  expect(close.disabled).toBe(true);
  const note = t("pos.heldCashCloseBlocked", { n: 3 });
  expect(note).toContain("3");
  expect(note).not.toBe("pos.heldCashCloseBlocked");
  expect(state.ui.text()).toContain(note);
});

it("leaves the close open when nothing waits", () => {
  state.ui.render(() => <PosCashDrawer shiftOpen shiftId="shift" currency="MXN" heldCash={0} />);
  expect(state.ui.all("button").find(b => b.text === "Close shift")!.disabled).toBe(false);
  expect(state.ui.text()).not.toContain("A manager must review");
});

it("the till reads the same restaurant-wide count the close refuses on, and passes only the number", () => {
  const page = readFileSync("src/app/dashboard/pos/page.tsx", "utf8");
  const route = readFileSync("src/app/api/cash-shift/route.ts", "utf8");
  expect(page).toContain("heldCashWaiting(createAdminClient(), membership.restaurant.id)");
  expect(route).toContain("heldCashWaiting(db, actor.restaurantId)");
  expect(page).toContain("heldCashWaiting={heldCash}");
  expect(readFileSync("src/components/dashboard/pos/PosScreen.tsx", "utf8")).toContain("heldCash={heldCashWaiting}");
  for (const locale of ["en", "es"] as const) {
    expect(translate(messagesFor(locale), "apiErr.shiftHeldCashCashier", { n: 2 })).toContain("2");
  }
});
