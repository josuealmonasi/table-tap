import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import type { ShiftView } from "@/lib/cash-shift";
import { pendingHarness } from "./pending-ui-harness";

// Full review, screens #2: a withdrawal that pays out a resolved held receipt
// is never removed by the server, so the drawer must not offer "Quitar" on it.
const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, locale: "en" as "en" | "es",
  movements: [] as Record<string, unknown>[], links: [] as Record<string, unknown>[], linkQuery: [] as unknown[] }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: state.locale }),
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q: Record<string, unknown> = {};
  for (const key of ["select", "eq", "order"]) q[key] = (...args: unknown[]) => { if (table === "held_sale_resolutions" && key === "eq") state.linkQuery.push(args); return q; };
  q.in = (...args: unknown[]) => { state.linkQuery.push(args); return q; };
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "cash_movements" ? state.movements : state.links, error: null }).then(resolve);
  return q;
} }) }));
import ShiftBlock from "@/components/dashboard/cash/ShiftBlock";
import { shiftWithdrawals } from "@/lib/cash-shift-server";

const withdrawal = { currency: "MXN", kind: "withdrawal" as const, amount: 40, note: null, actor_email: "cashier", created_at: "2026-11-11T09:00:00Z", purpose: "other" as const };
const view: ShiftView = {
  shift: { id: "shift", currency: "MXN", opened_at: "2026-11-11T08:00:00Z", closed_at: null,
    opened_by: "a", closed_by: null, opening_amount: 20, expected_cash: null, counted_cash: null,
    difference: null, difference_note: null, explained_by: null },
  sum: { opening: 20, cashSales: 0, withdrawn: 80, expected: -60 },
  trail: [], withdrawals: [{ ...withdrawal, id: "free", linked: false }, { ...withdrawal, id: "backs", linked: true }],
};
beforeEach(() => { vi.stubGlobal("React", React); state.ui = pendingHarness(); state.locale = "en"; state.linkQuery = []; });

it.each(["en", "es"] as const)("hides Remove on a withdrawal backing a resolution and says why (%s)", locale => {
  state.locale = locale;
  state.ui.render(() => <ShiftBlock shifts={[view]} currency="MXN" timeZone="UTC" restaurantName="Cafe" />);
  const t = (key: string) => translate(messagesFor(locale), key);
  const items = state.ui.all("li");
  expect(items).toHaveLength(2);
  const remove = (n: (typeof items)[number]) => n.children.flatMap(function walk(c): typeof items { return [c, ...c.children.flatMap(walk)]; })
    .filter(c => c.type === "button" && c.text === t("corte.removeWithdrawal"));
  expect(remove(items[0])).toHaveLength(1);
  expect(remove(items[1])).toHaveLength(0);
  expect(items[1].text).toContain(t("corte.withdrawalLinked"));
  expect(items[0].text).not.toContain(t("corte.withdrawalLinked"));
  expect(t("corte.withdrawalLinked")).not.toBe("corte.withdrawalLinked");
});

it("the withdrawal read marks exactly the withdrawals a resolution links, in this restaurant", async () => {
  state.movements = [{ ...withdrawal, id: "free", amount: "40" }, { ...withdrawal, id: "backs", amount: "40", purpose: "tips" }];
  state.links = [{ payout_id: "backs" }];
  const rows = await shiftWithdrawals("restaurant", "shift");
  expect(rows.map(r => ({ id: r.id, linked: r.linked, purpose: r.purpose, amount: r.amount }))).toEqual([
    { id: "free", linked: false, purpose: "other", amount: 40 }, { id: "backs", linked: true, purpose: "tips", amount: 40 }]);
  expect(state.linkQuery).toContainEqual(["restaurant_id", "restaurant"]);
  expect(state.linkQuery).toContainEqual(["payout_id", ["free", "backs"]]);
});
