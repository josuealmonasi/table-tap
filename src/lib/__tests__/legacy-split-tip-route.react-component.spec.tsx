import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { state } from "./legacy-split-tip-fixture";
import { POST } from "@/app/api/split/pay/route";

const pay = (tip: Record<string, unknown> = {}) => POST(new NextRequest("https://test/api/split/pay", {
  method: "POST", body: JSON.stringify({ splitId: "split", sessionId: "session", restaurantId: "restaurant",
    tableId: "table", ownOrderIds: [], ...tip }),
}));
beforeEach(() => { vi.clearAllMocks(); state.principal = null; state.prior = null; });

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
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("refuses an open page whose gross no longer matches the share and exact tip", async () => {
  state.prior = { url: "https://checkout.invalid/existing", metadata: { settle_tip: "5" }, amount_total: 7500 };
  expect((await pay({ tipAmount: 5 })).status).toBe(409);
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});

it("does not guess an open page's tip when its saved evidence is invalid", async () => {
  state.prior = { url: "https://checkout.invalid/existing", metadata: { settle_tip: "unknown" }, amount_total: 6500 };
  expect((await pay({ tipAmount: 5 })).status).toBe(503);
  expect(state.reserve).not.toHaveBeenCalled();
  expect(state.open).not.toHaveBeenCalled();
});
