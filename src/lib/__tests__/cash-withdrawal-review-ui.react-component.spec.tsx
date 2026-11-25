import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import type { ShiftView } from "@/lib/cash-shift";
import { pendingHarness } from "./pending-ui-harness";

// Cash withdrawals: approval, cap and retired references (2026-11-25). The
// manager sees a cashier's pending withdrawal with who, when, how much and why,
// approves or rejects it, and the drawer shows it apart from what is subtracted.
const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, locale: "en" as "en" | "es",
  confirm: vi.fn(), fetch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
import ShiftBlock from "@/components/dashboard/cash/ShiftBlock";

const base = { currency: "MXN", kind: "withdrawal" as const, note: "cambio", created_at: "2026-11-25T09:00:00Z", purpose: "other" as const };
const view: ShiftView = {
  shift: { id: "shift", currency: "MXN", opened_at: "2026-11-25T08:00:00Z", closed_at: null,
    opened_by: "a", closed_by: null, opening_amount: 100, expected_cash: null, counted_cash: null,
    difference: null, difference_note: null, explained_by: null },
  sum: { opening: 100, cashSales: 0, withdrawn: 10, expected: 90 },
  trail: [],
  withdrawals: [
    { ...base, id: "mine", amount: 10, actor_email: "manager@x", status: "approved" },
    { ...base, id: "asked", amount: 60, actor_email: "cashier@x", status: "pending" },
    { ...base, id: "refused", amount: 5, actor_email: "cashier@x", status: "rejected", reviewed_by: "boss@x" },
  ],
};
const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars);
beforeEach(() => {
  vi.stubGlobal("React", React);
  state.ui = pendingHarness(); state.locale = "en";
  state.confirm.mockReset().mockResolvedValue(true);
  state.fetch.mockReset().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", state.fetch);
});

it.each(["en", "es"] as const)("shows a pending withdrawal with who, when, amount and note, and Approve/Reject instead of Remove (%s)", locale => {
  state.locale = locale;
  state.ui.render(() => <ShiftBlock shifts={[view]} currency="MXN" timeZone="UTC" restaurantName="Cafe" />);
  const items = state.ui.all("li");
  expect(items).toHaveLength(3);
  const [mine, asked, refused] = items;
  const labels = (n: (typeof items)[number]) => n.children.flatMap(function walk(c): typeof items { return [c, ...c.children.flatMap(walk)]; })
    .filter(c => c.type === "button").map(c => c.text);
  expect(labels(mine)).toEqual([t("corte.removeWithdrawal")]);
  expect(labels(asked)).toEqual([t("corte.approveWithdrawal"), t("corte.rejectWithdrawal")]);
  expect(labels(refused)).toEqual([]);
  expect(asked.text).toContain("cashier@x");
  expect(asked.text).toContain("cambio");
  expect(asked.text).toContain("09:00");
  expect(asked.text).toContain(t("corte.withdrawalPending"));
  expect(refused.text).toContain(t("corte.withdrawalRejectedBy", { who: "boss@x" }));
  // Shown apart, never in the subtraction the expected cash is made of.
  expect(state.ui.text()).toContain(t("corte.pendingWithdrawals"));
  for (const key of ["corte.withdrawalPending", "corte.approveWithdrawal", "corte.rejectWithdrawal", "corte.pendingWithdrawals",
    "corte.withdrawalRejectedBy", "corte.approveWithdrawalMsg", "corte.rejectWithdrawalMsg"]) expect(t(key)).not.toBe(key);
});

it.each([["approve", 0], ["reject", 1]] as const)("%s asks first, then sends the decision for that withdrawal", async (decision, at) => {
  state.ui.render(() => <ShiftBlock shifts={[view]} currency="MXN" timeZone="UTC" restaurantName="Cafe" />);
  const asked = state.ui.all("li")[1];
  const button = (asked.children.flatMap(function walk(c): typeof asked[] { return [c, ...c.children.flatMap(walk)]; })
    .filter(c => c.type === "button"))[at];
  await button.props.onClick!();
  expect(state.confirm).toHaveBeenCalledOnce();
  expect(state.confirm.mock.calls[0][0].message).toContain("cashier@x");
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith("/api/cash-drawer", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ id: "asked", decision }),
  }));
});

it("sends nothing when the manager cancels the dialog", async () => {
  state.confirm.mockResolvedValue(false);
  state.ui.render(() => <ShiftBlock shifts={[view]} currency="MXN" timeZone="UTC" restaurantName="Cafe" />);
  const asked = state.ui.all("li")[1];
  const approve = asked.children.flatMap(function walk(c): typeof asked[] { return [c, ...c.children.flatMap(walk)]; })
    .find(c => c.type === "button")!;
  await approve.props.onClick!();
  expect(state.fetch).not.toHaveBeenCalled();
});
