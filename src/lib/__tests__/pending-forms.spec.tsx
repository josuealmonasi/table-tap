import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { pendingHarness } from "./pending-ui-harness";
const state = vi.hoisted(() => ({ ui: null as unknown as ReturnType<typeof pendingHarness>, fetch: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
  useCallback: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string) => k }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/hooks/useWhen", () => ({ useWhen: () => () => "today" }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
import CashMovementDialog from "@/components/dashboard/cash/CashMovementDialog";
import CloseShiftDialog from "@/components/dashboard/cash/CloseShiftDialog";
import PurchaseDialog from "@/components/dashboard/costs/PurchaseDialog";
import CountDialog from "@/components/dashboard/costs/CountDialog";
import WasteRecorder, { type WasteChoice } from "@/components/dashboard/costs/WasteRecorder";
import type { StockIngredient } from "@/lib/costs/stock-server";
const ingredients = [{ id: "milk", name: "Milk", unit: "ml", pack_size: 1000, pack_price: 20 }] as StockIngredient[];
beforeEach(() => {
  vi.stubGlobal("React", React); state.ui = pendingHarness(); state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch);
  state.fetch.mockRejectedValueOnce(new Error("lost reply"));
});
const bodies = () => state.fetch.mock.calls.map(c => JSON.parse(c[1].body));
function locked() {
  expect(state.ui.text()).toContain("pending.sendAgain");
  expect([...state.ui.all("input"), ...state.ui.all("select")].every(n => n.disabled)).toBe(true);
}
// A refused retry keeps its request: the first may still commit. The person
// lets it go on purpose, through the banner's question.
async function discard() {
  for (const label of ["pending.discard", "pending.discardConfirm"]) {
    const button = state.ui.all("button").find(n => n.text === label)!;
    expect(button, label).toBeDefined();
    await button.props.onClick!(); state.ui.render();
  }
}
it("S20b withdrawal reopens showing the frozen amount and note, retries, then opens fresh", async () => {
  let kind: "withdrawal" | null = "withdrawal", currency = "MXN";
  const render = () => <CashMovementDialog kind={kind} currency={currency} shiftId="s" onClose={() => { kind = null; }} onSaved={vi.fn()} />;
  state.ui.render(render); state.ui.change(state.ui.all("input")[0], "50"); state.ui.change(state.ui.all("input")[1], "Delivery");
  await state.ui.submit(); kind = null; state.ui.render(); currency = "USD"; kind = "withdrawal"; state.ui.render();
  expect(state.ui.all("input").map(n => n.props.value)).toEqual(["50", "Delivery"]); locked(); expect(state.ui.text()).toContain("MXN"); expect(state.ui.text()).not.toContain("USD");
  state.fetch.mockResolvedValueOnce(Response.json({ id: "saved" })); await state.ui.submit();
  expect(bodies()[1]).toEqual(bodies()[0]); kind = "withdrawal"; state.ui.render();
  expect(state.ui.all("input")[0].props.value).toBe("");
});
it("S20b shift close reopens with the original blind count and confirmation", async () => {
  let open = true;
  state.ui.render(() => <CloseShiftDialog open={open} currency="MXN" shiftId="s" onClose={vi.fn()} onClosed={vi.fn()} />);
  state.ui.change(state.ui.all("input")[0], "125"); state.ui.change(state.ui.all("input")[1], true); await state.ui.submit();
  open = false; state.ui.render(); open = true; state.ui.render();
  expect(state.ui.all("input")[0].props.value).toBe("125"); expect(state.ui.all("input")[1].props.checked).toBe(true); locked();
  state.fetch.mockResolvedValueOnce(Response.json({ error: "stale" }, { status: 409 })); await state.ui.submit();
  expect(bodies()[1]).toEqual(bodies()[0]); locked();
  await discard(); expect(state.ui.all("input")[0].disabled).toBe(false);
  open = false; state.ui.render(); open = true; state.ui.render(); expect(state.ui.all("input")[0].props.value).toBe("");
});
it("S20b purchase restores its remounted fields from the parent sender", async () => {
  let open = true, available = ingredients;
  state.ui.render(() => <PurchaseDialog open={open} currency="MXN" ingredients={available} onClose={() => { open = false; }} />);
  state.ui.change(state.ui.all("select")[0], "milk"); state.ui.change(state.ui.all("input")[0], "2"); state.ui.change(state.ui.all("input")[1], "40"); await state.ui.submit();
  open = false; state.ui.render(); available = []; open = true; state.ui.render();
  expect(state.ui.all("select")[0].props.value).toBe("milk"); expect(state.ui.text()).toContain("Milk"); expect(state.ui.all("input").map(n => n.props.value)).toEqual(["2", "40"]); locked();
  state.fetch.mockResolvedValueOnce(Response.json({ ok: true })); await state.ui.submit(); expect(bodies()[1]).toEqual(bodies()[0]);
  open = true; state.ui.render(); expect(state.ui.all("input")[0].props.value).toBe("");
});
it("S20b shelf count restores display units on reopen, and a refused retry is let go on purpose", async () => {
  let open = true, available = ingredients;
  state.ui.render(() => <CountDialog open={open} currency="MXN" ingredients={available} onClose={vi.fn()} />);
  state.ui.change(state.ui.all("input")[0], "1.5"); await state.ui.submit(); open = false; state.ui.render(); available = [{ ...ingredients[0], name: "Changed", unit: "pza" }]; open = true; state.ui.render();
  expect(state.ui.all("input")[0].props.value).toBe("1.5"); locked(); expect(state.ui.text()).toContain("Milk"); expect(state.ui.text()).toContain("costs.unitShort.l");
  state.fetch.mockResolvedValueOnce(Response.json({ error: "refused" }, { status: 422 })); await state.ui.submit();
  expect(bodies()[1]).toEqual(bodies()[0]); expect(bodies()[0].counts[0].counted).toBe(1500); locked();
  await discard(); expect(state.ui.all("input")[0].disabled).toBe(false);
});
it("S20b waste locks the visible choice, quantity, reason and note until resolved", async () => {
  let choices = [{ kind: "ingredient", id: "milk", label: "Milk", unit: "ml" }] as WasteChoice[];
  state.ui.render(() => <WasteRecorder choices={choices} today={[]} currency="MXN" timeZone="UTC" canSeeCost />);
  state.ui.change(state.ui.all("select")[0], "ingredient:milk"); state.ui.change(state.ui.all("input")[0], "0.5");
  state.ui.all("button").find(n => n.props.role === "radio")!.props.onClick!(); state.ui.render(); await state.ui.submit(); choices = []; state.ui.render(); locked(); expect(state.ui.text()).toContain("Milk");
  state.ui.change(state.ui.all("input")[0], "9"); expect(state.ui.all("input")[0].props.value).toBe("0.5");
  expect(state.ui.all("button").filter(n => n.props.role === "radio").every(n => n.disabled)).toBe(true);
  state.fetch.mockResolvedValueOnce(Response.json({ ok: true })); await state.ui.submit(); expect(bodies()[1]).toEqual(bodies()[0]);
  expect(state.ui.all("input")[0].props.value).toBe(""); expect(state.ui.all("select")[0].disabled).toBe(false);
});
it.each([401, 403, 408, 425, 429, 503])("S20b purchase stays visible and locked after an unknown %i answer", async status => {
  let open = true;
  state.ui.render(() => <PurchaseDialog open={open} currency="MXN" ingredients={ingredients} onClose={() => { open = false; }} />);
  state.ui.change(state.ui.all("select")[0], "milk"); state.ui.change(state.ui.all("input")[0], "2"); state.ui.change(state.ui.all("input")[1], "40"); await state.ui.submit();
  open = false; state.ui.render(); open = true; state.ui.render();
  state.fetch.mockResolvedValueOnce(Response.json({ error: "try later" }, { status })); await state.ui.submit(); locked();
  expect(state.ui.all("input").map(n => n.props.value)).toEqual(["2", "40"]); expect(bodies()[1]).toEqual(bodies()[0]);
  state.fetch.mockResolvedValueOnce(Response.json({ error: "refused" }, { status: 422 })); await state.ui.submit();
  locked(); await discard();
  expect(state.ui.all("input")[0].disabled).toBe(false); state.ui.change(state.ui.all("input")[1], "60");
  state.fetch.mockResolvedValueOnce(Response.json({ ok: true })); await state.ui.submit();
  expect(bodies()[3].ref).not.toBe(bodies()[0].ref); expect(bodies()[3].total).toBe("60");
});
it("S20b a saved shelf count shows its result and the next count opens empty", async () => {
  let open = true;
  state.ui.render(() => <CountDialog open={open} currency="MXN" ingredients={ingredients} onClose={vi.fn()} />);
  state.ui.change(state.ui.all("input")[0], "1.5"); await state.ui.submit(); open = false; state.ui.render(); open = true; state.ui.render();
  state.fetch.mockResolvedValueOnce(Response.json({ results: [{ ingredientId: "milk", counted: 1500, expected: null }] })); await state.ui.submit();
  expect(bodies()[1]).toEqual(bodies()[0]); expect(state.ui.text()).toContain("costs.countResults");
  open = false; state.ui.render(); open = true; state.ui.render();
  expect(state.ui.all("input")[0].props.value).toBe(""); expect(state.ui.all("input")[0].disabled).toBe(false);
});
it("a purchase reopened while its first send is out says nothing until the reply is lost (cross-review of batch 5)", async () => {
  let open = true;
  let lose!: (error: Error) => void;
  state.fetch.mockReset().mockImplementationOnce(() => new Promise((_, reject) => { lose = reject; }));
  state.ui.render(() => <PurchaseDialog open={open} currency="MXN" ingredients={ingredients} onClose={() => { open = false; }} />);
  state.ui.change(state.ui.all("select")[0], "milk"); state.ui.change(state.ui.all("input")[0], "2"); state.ui.change(state.ui.all("input")[1], "40");
  const sending = state.ui.submit();
  open = false; state.ui.render(); open = true; state.ui.render();
  expect(state.ui.text()).not.toContain("pending.purchase");
  lose(new Error("lost reply")); await sending; state.ui.render();
  expect(state.ui.text()).toContain("pending.purchase");
});
