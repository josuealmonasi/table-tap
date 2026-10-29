import { randomUUID } from "node:crypto";
import { splitSlotFixture } from "./split-slots-fixture.mjs";
import { memberFixture } from "./table-member-fixture.mjs";
import { navigate, ready, trackData } from "./browser-ready.mjs";

const checked = async query => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};
/** Each browser visit owns its table, membership and receipts; none borrows the demo's money. */
export async function splitScreenFixture(admin, restaurantId, start = true) {
  const f = await splitSlotFixture(admin, restaurantId, { totalCents: 11000, shares: 3, start });
  const phones = memberFixture(admin, restaurantId);
  const requestId = randomUUID();
  let collectedReceipt;
  const tableLabel = `split-${f.startBody.ref.slice(0, 8)}`;
  const cleanup = async () => {
    try { await checked(admin.from("service_requests").delete().eq("id", requestId)); }
    finally { try { await phones.cleanup(); } finally { await f.cleanup(); } }
  };
  try {
    await checked(admin.from("table_sessions").update({ opened_by: null }).eq("id", f.scope.sessionId));
    const cookie = await phones.cookieFor("/api/bill", { ...f.scope, diner: "slot-screen" });
    if (start) {
      const b = f.body([0]);
      const result = await f.rpc("collect_split_slots_v1", { p_restaurant: restaurantId, p_split: f.splitId,
        p_revision: 1, p_slots: b.slots, p_expected_cents: b.expectedCents, p_currency: b.currency,
        p_tip_cents: 0, p_method: "cash", p_actor: "split-screen-fixture", p_ref: b.ref });
      if (result.outcome !== "collected") throw new Error(`screen collection: ${result.outcome}`);
      collectedReceipt = result;
      const held = await f.hold([1], phones.idFor(f.scope.sessionId, "slot-screen"));
      if (held.result.outcome !== "reserved") throw new Error(`screen reservation: ${held.result.outcome}`);
      await checked(admin.from("service_requests").insert({ id: requestId, restaurant_id: restaurantId,
        table_id: f.scope.tableId, table_label: tableLabel, kind: "pay" }));
    }
    return { ...f, cookie, tableLabel, cleanup, collectedReceipt };
  } catch (error) { await cleanup(); throw error; }
}

/** Reach the actual collection doors; a missing opener must fail, never measure the board twice. */
export async function openSplitScreen({ ctx, tab, phase }, { fixture, screen, base, lang = "es" }) {
  const f = fixture;
  const pending = trackData(tab);
  await ctx.addCookies([{ name: "tt-locale", value: lang, url: base }]);
  if (screen.role === "diner") {
    await ctx.addCookies([{ name: "tt-table-member", value: f.cookie.split("=")[1], url: base }]);
    // Dialog sweeps hold browser writes. Verify this real fixture credential
    // once, then replay only its admission response without opening a write door.
    const response = await fetch(`${base}/api/table-membership`, { method: "POST",
      headers: { "content-type": "application/json", cookie: f.cookie }, body: JSON.stringify(f.scope) });
    const admission = await response.json();
    if (!response.ok || admission.status !== "approved" || admission.sessionId !== f.scope.sessionId) {
      throw new Error("could not admit the private split-screen phone");
    }
    await tab.route("**/api/table-membership", route => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON();
      if (body.restaurantId !== f.scope.restaurantId || body.tableId !== f.scope.tableId) return route.fallback();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(admission) });
    });
    await ctx.addInitScript(({ restaurantId, tableId, sessionId }) => {
      localStorage.setItem(`tt-sitting:${restaurantId}`, JSON.stringify({ tableId, sessionId }));
    }, f.scope);
    await navigate(tab, `${base}/r/${f.scope.restaurantId}/t/${f.scope.tableId}`, phase, pending);
    await tab.getByRole("button", { name: /ver mi cuenta|view my bill/i }).click();
    if (screen.state === "start") {
      await tab.locator(".tt-split-ask input").check();
      await tab.locator(".tt-split select").selectOption("20");
    } else await tab.locator("[data-split-slot='2'] input").check();
  } else if (screen.door === "bills") {
    const promotion = ["promotion", "writeoff"].includes(screen.state);
    await navigate(tab, `${base}/dashboard/bills${promotion ? "" : `?order=${f.orderId}`}`, phase, pending);
    if (promotion) {
      await tab.locator(".tt-bill-open-main").filter({ hasText: f.tableLabel }).click();
      if (screen.state === "writeoff") await tab.locator(".tt-bill-close").click();
    }
  } else {
    await navigate(tab, `${base}/dashboard/orders`, phase, pending);
    const chip = tab.locator(".tt-request-chip").filter({ hasText: f.tableLabel });
    await chip.getByRole("button", { name: /cobrar|collect/i }).click();
  }
  await phase("readiness", () => ready(tab, { pending }));
  const target = screen.state === "start" ? ".tt-split select"
    : screen.state === "promotion" ? ".tt-bill-close"
    : screen.state === "writeoff" ? ".tt-writeoff-amount" : "[data-split-model='2']";
  await tab.locator(target).waitFor({ state: "visible" });
  if (screen.state === "receipt") {
    // Reuse the fixture's paid receipt. A browser sweep never collects more money.
    await tab.route("**/api/split/collect", route => route.fulfill({ status: 200,
      contentType: "application/json", body: JSON.stringify({ ok: true, ...f.collectedReceipt }) }));
    await tab.locator("[data-split-slot='2'] input").check();
    await tab.getByRole("button", { name: /pagó en efectivo|paid cash/i }).click();
    await tab.locator("[data-slot-receipt-print]").waitFor({ state: "visible" });
  }
}
