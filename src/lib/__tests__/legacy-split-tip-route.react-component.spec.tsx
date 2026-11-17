import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { state } from "./legacy-split-tip-fixture";
import { EXACT_TIP_CASES } from "./exact-tip-cases";
import { POST } from "@/app/api/split/pay/route";
import { splitTakesExactTipOnly } from "@/lib/tip-base";

const pay = (tip: Record<string, unknown> = {}) => POST(new NextRequest("https://test/api/split/pay", {
  method: "POST", body: JSON.stringify({ splitId: "split", sessionId: "session", restaurantId: "restaurant",
    tableId: "table", ownOrderIds: [], ...tip }),
}));
beforeEach(() => { vi.clearAllMocks(); state.principal = null; state.amount = 120; state.prior = null; state.own = []; });
const dessert = { id: "dessert", total: 40, currency: "MXN", paid: false, diner: "member",
  created_at: "2026-10-20T12:00:00Z", items: [] };

it("asks for an exact tip before reserving a fee or opening checkout for old splits", async () => {
  const response = await pay({ tipPct: 10 });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.splitExactTip" });
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it.each([0, 5.25, 500])("keeps the old share payable with exact tip %s", async tipAmount => {
  expect((await pay({ tipAmount, tipPct: 10 })).status).toBe(200);
  const tip = Math.min(tipAmount, 60);
  expect(state.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    metadata: expect.objectContaining({ settle_tip: String(tip) }),
    line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 6000 + tip * 100 }) })],
  }), expect.anything());
});

it("still opens old shares with no tip", async () => {
  expect((await pay()).status).toBe(200);
  expect(state.open).toHaveBeenCalled();
});

it("keeps percentage tips for a trusted saved principal", async () => {
  state.principal = 100;
  expect((await pay({ tipPct: 10 })).status).toBe(200);
  expect(state.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    metadata: expect.objectContaining({ settle_tip: "5" }),
  }), expect.anything());
});

it("keeps a saved zero principal valid for percentage tips", async () => {
  state.principal = 0;
  expect((await pay({ tipPct: 10 })).status).toBe(200);
  expect(state.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    metadata: expect.objectContaining({ settle_tip: "0" }),
  }), expect.anything());
});

it("rejects nonfinite exact amounts before opening checkout", async () => {
  expect((await pay({ tipAmount: "Infinity" })).status).toBe(400);
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("does not resume a different tip behind the exact amount the diner just chose", async () => {
  state.prior = { url: "https://checkout.invalid/existing", metadata: { settle_tip: "6" }, amount_total: 6600 };
  expect((await pay({ tipAmount: 5 })).status).toBe(409);
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("resumes the identical exact-tip page without a second fee or checkout", async () => {
  state.prior = { url: "https://checkout.invalid/existing", metadata: { settle_tip: "5" }, amount_total: 6500 };
  const response = await pay({ tipAmount: 5 });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: state.prior.url });
  expect(state.expire).not.toHaveBeenCalled();
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("closes a page whose total the share no longer owes and opens one at today's total", async () => {
  state.prior = { id: "cs_old", url: "https://checkout.invalid/existing", metadata: { settle_tip: "5" }, amount_total: 7500 };
  const response = await pay({ tipAmount: 5 });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: "https://checkout.invalid/share" });
  expect(state.expire).toHaveBeenCalledExactlyOnceWith("cs_old", {}, { stripeAccount: "acct" });
  expect(state.reserve).toHaveBeenCalledTimes(1);
  expect(state.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 6500 }) })],
  }), expect.anything());
});

it("lets a diner who cancelled, then ordered dessert, pay the new total", async () => {
  // The old page was opened for MX$60 and abandoned with ?cancelled=1. Refusing
  // it left every Pay answering "bill changed" until Stripe expired it.
  state.prior = { id: "cs_old", url: "https://checkout.invalid/existing", metadata: { settle_tip: "0" }, amount_total: 6000 };
  state.own = [dessert];
  const response = await pay({ tipAmount: 0, ownOrderIds: ["dessert"] });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: "https://checkout.invalid/share" });
  expect(state.expire).toHaveBeenCalledTimes(1);
  // The old page's fee goes back through its attempt; the new one is reserved once.
  expect(state.resume).toHaveBeenCalledTimes(2);
  expect(state.reserve).toHaveBeenCalledTimes(1);
  expect(state.open).toHaveBeenCalledTimes(1);
  expect(state.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    metadata: expect.objectContaining({ settle_tip: "0", settle_order_ids: "dessert" }),
    line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 10000 }) })],
  }), expect.anything());
});

it.each([
  { name: "Stripe refuses to expire it", expire: async () => { throw new Error("already complete"); } },
  { name: "it was paid meanwhile", expire: async (id: string) => ({ id, status: "complete", payment_status: "paid" }) },
])("tells the diner to reload when the stale page cannot be closed: $name", async ({ expire }) => {
  state.prior = { id: "cs_old", url: "https://checkout.invalid/existing", metadata: { settle_tip: "0" }, amount_total: 6000 };
  state.own = [dessert];
  state.expire.mockImplementationOnce(expire as never);
  const response = await pay({ tipAmount: 0, ownOrderIds: ["dessert"] });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.splitPageChanged" });
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("does not open a second page when another request opened one after the expiry", async () => {
  state.prior = { id: "cs_old", url: "https://checkout.invalid/existing", metadata: { settle_tip: "0" }, amount_total: 6000 };
  state.own = [dessert];
  state.resume.mockImplementationOnce(async () => state.prior)
    .mockImplementationOnce(async () => ({ url: "https://checkout.invalid/other", metadata: { settle_tip: "0" }, amount_total: 10000 }));
  const response = await pay({ tipAmount: 0, ownOrderIds: ["dessert"] });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.splitPageChanged" });
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("does not guess an open page's tip when its saved evidence is invalid", async () => {
  state.prior = { url: "https://checkout.invalid/existing", metadata: { settle_tip: "unknown" }, amount_total: 6500 };
  expect((await pay({ tipAmount: 5 })).status).toBe(503);
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it.each([
  { savedTip: "6", gross: 6600, error: "apiErr.splitOpenTip" },
  { savedTip: "5", gross: 7500, error: "apiErr.splitPageChanged" },
])("refuses a concurrent winner's checkout when its quote differs: $error", async ({ savedTip, gross, error }) => {
  // Both requests saw no prior attempt. The shared attempt opener returns the
  // winner's persisted checkout to the loser instead of creating another one.
  state.open.mockImplementationOnce(async () => ({ url: "https://checkout.invalid/winner",
    metadata: { settle_tip: savedTip }, amount_total: gross }));
  const response = await pay({ tipAmount: 5 });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error });
  // A winner opened moments ago is a race, never a stale page: it stays open.
  expect(state.expire).not.toHaveBeenCalled();
  expect(state.open).toHaveBeenCalledTimes(1);
  expect(state.reserve).toHaveBeenCalledTimes(1);
});

it.each([0, 5.25])("returns the concurrent winner when exact tip %s and gross both match", async tip => {
  state.open.mockImplementationOnce(async () => ({ url: "https://checkout.invalid/winner",
    metadata: { settle_tip: String(tip) }, amount_total: 6000 + tip * 100 }));
  const response = await pay({ tipAmount: tip });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: "https://checkout.invalid/winner" });
  expect(state.open).toHaveBeenCalledTimes(1);
});

it.each(["", " ", "-1", "unknown"])("refuses invalid persisted tip evidence %j on either return path", async savedTip => {
  const session = { url: "https://checkout.invalid/unverified", metadata: { settle_tip: savedTip }, amount_total: 6000 };
  state.prior = session;
  expect((await pay({ tipAmount: 0 })).status).toBe(503);
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
  state.prior = null;
  state.open.mockImplementationOnce(async () => session);
  const response = await pay({ tipAmount: 0 });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "apiErr.verifyOrders" });
  expect(state.open).toHaveBeenCalledTimes(1);
});

it.each(EXACT_TIP_CASES)("refuses a percentage exactly when the shared rule says exact only: $name", async c => {
  state.principal = c.food_principal; state.amount = c.amount;
  expect(splitTakesExactTipOnly(c)).toBe(c.exactOnly);
  const response = await pay({ tipPct: 10 });
  expect(response.status).toBe(c.exactOnly ? 409 : 200);
  if (c.exactOnly) expect(await response.json()).toEqual({ error: "apiErr.splitExactTip" });
});
