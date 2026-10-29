import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { returnFixture, ORDER } from "./returns-contract-fixtures";
import { readOrderReceipt } from "@/lib/receipt-source";
import { buildReceipt } from "@/lib/receipt";
import type { createAdminClient } from "@/lib/supabase/admin";
let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-receipt-signing-key"); fixture = returnFixture();
  Object.assign(fixture.tables.orders[0], { total: 30, subtotal: 70, created_at: "2026-10-27T18:00:00Z", items: [] });
  fixture.tables.order_adjustments = [{ id: "return", kind: "return", order_id: ORDER, restaurant_id: "r1", currency: "MXN",
    previous_total: 80, resulting_total: 30, previous_tip: 10, resulting_tip: 10, previous_service_fee: 0, resulting_service_fee: 0 }];
  fixture.tables.refund_operations = [{ id: "card", restaurant_id: "r1", adjustment_id: "return", source: "stripe", amount: 40, currency: "MXN", status: "succeeded", completed_at: "2026-10-28T12:00:00Z" },
    { id: "cash", restaurant_id: "r1", adjustment_id: "return", source: "cash", amount: 10, currency: "MXN", status: "pending", completed_at: null }];
});
afterEach(() => vi.unstubAllEnvs());
const db = () => fixture as unknown as ReturnType<typeof createAdminClient>;
const read = (version?: Parameters<typeof readOrderReceipt>[4]) => readOrderReceipt(db(), [ORDER], false, undefined, version);
const rendered = (orders: Awaited<ReturnType<typeof read>>["orders"]) => buildReceipt(orders, { name: "Bistro", locale: "en-US", timeZone: "UTC" }, key => key).html;
it("reads original, completed, pending and retained into the shared print/email renderer", async () => {
  const source = await read();
  expect(source.orders[0]).toMatchObject({ total: 30, return_components: { total: 50, tip: 0, service_fee: 0 }, returns: [{ amount: 40 }, { amount: 10 }] });
  expect(rendered(source.orders)).toContain("receipt.returnPending"); expect(source.version?.returnCopy).toEqual(expect.any(String));
});
it("reprints a saved version after another return and a provider failure", async () => {
  const issued = await read(); const html = rendered(issued.orders);
  fixture.tables.orders[0].total = 20;
  fixture.tables.order_adjustments.push({ ...fixture.tables.order_adjustments[0], id: "return-two", previous_total: 30, resulting_total: 20 });
  fixture.tables.refund_operations[0].status = "failed";
  const reprint = await read(issued.version);
  expect(rendered(reprint.orders)).toEqual(html);
  expect((await read({ adjustmentIds: [] })).orders[0].total).toBe(80);
});
it("rejects a modified signed copy or one used for another restaurant", async () => {
  const issued = await read(); const version = issued.version!;
  const [body, sig] = version.returnCopy!.split(".");
  const saved = JSON.parse(Buffer.from(body, "base64url").toString()); saved.orders[0].total = 999;
  await expect(read({ ...version, returnCopy: `${Buffer.from(JSON.stringify(saved)).toString("base64url")}.${sig}` })).rejects.toMatchObject({ status: 404 });
  fixture.tables.orders[0].restaurant_id = "r2";
  await expect(read(version)).rejects.toMatchObject({ status: 404 });
});
it("preserves forgiveness before a return without turning forgiven debt into returned money", async () => {
  fixture.tables.order_adjustments.push({ id: "loss", kind: "forgive", order_id: ORDER, restaurant_id: "r1", currency: "MXN",
    previous_total: 100, resulting_total: 80, forgiven: 20, previous_tip: 10, resulting_tip: 10,
    previous_service_fee: 0, resulting_service_fee: 0 });
  const source = await read();
  expect(source.orders[0]).toMatchObject({ total: 30, forgiveness: { forgiven: 20 }, return_components: { total: 50 } });
  expect(rendered(source.orders)).toContain("MX$100.00"); expect(rendered(source.orders)).toContain("MX$80.00");
});
it("shows a manual partial as completed money without calling the whole operation returned", async () => {
  fixture.tables.refund_operations = [{ id: "partial", restaurant_id: "r1", adjustment_id: "return", source: "stripe", amount: 50,
    currency: "MXN", status: "processing", completed_at: null }];
  fixture.rpc.mockResolvedValue({ data: { outstanding_cents: 1000 }, error: null });
  const source = await read(); const html = rendered(source.orders);
  expect(source.orders[0].returns?.[0]).toMatchObject({ status: "processing", returned_cents: 4000 });
  expect(html).toContain("MX$40.00"); expect(html).toContain("MX$10.00");
});
it("keeps a slot receipt on its own payment while showing that payment's returned part", async () => {
  const { readSlotReceipt } = await import("@/lib/receipt-source");
  fixture.tables.payments = [{ id: "payment", restaurant_id: "r1", session_id: "session", amount: 80, tip: 10, currency: "MXN", created_at: "2026-10-27T18:00:00Z" }];
  fixture.tables.bill_split_slots = [{ payment_id: "payment", restaurant_id: "r1", split_id: "split", share_no: 0, amount_cents: 8000 }];
  fixture.tables.bill_splits = [{ id: "split", restaurant_id: "r1", session_id: "session", model_version: 2, currency: "MXN" }];
  fixture.tables.payment_allocations = [{ id: "allocation", restaurant_id: "r1", payment_id: "payment" }];
  fixture.tables.refund_allocations = [{ id: "link", restaurant_id: "r1", allocation_id: "allocation", operation_id: "cash", amount: 10, tip: 0 }];
  const source = await readSlotReceipt(db(), "payment");
  const receipt = buildReceipt([], { name: "Bistro", locale: "en-US", timeZone: "UTC" }, key => key, source.payment);
  expect(receipt.text).toContain("receipt.original  MX$80.00");
  expect(receipt.text).toContain("receipt.returnPending  MX$10.00");
  expect(receipt.text).toContain("receipt.retained  MX$70.00");
});
it("shows a paid order cancelled and refunded in full as returned, not as MX$100 owed (sweep 4, finding 1)", async () => {
  Object.assign(fixture.tables.orders[0], { total: 100, tip: 0, service_fee: 0, paid: true });
  fixture.tables.order_adjustments = [{ id: "cancel", kind: "cancel", order_id: ORDER, restaurant_id: "r1", currency: null,
    previous_total: 100, previous_tip: 0, resulting_total: null, resulting_tip: null }];
  fixture.tables.refund_operations = [{ id: "cash", restaurant_id: "r1", adjustment_id: "cancel", source: "cash", amount: 100,
    currency: "MXN", status: "succeeded", completed_at: "2026-10-28T12:00:00Z" }];
  const source = await read();
  expect(source.orders[0]).toMatchObject({ total: 0, return_components: { total: 100 }, returns: [{ amount: 100 }] });
  expect(rendered(source.orders)).toContain("MX$100.00");
  // An issued copy stays what it was.
  expect((await read({ adjustmentIds: [] })).orders[0].total).toBe(100);
});
it("leaves an unpaid cancelled order alone: nothing was given back", async () => {
  Object.assign(fixture.tables.orders[0], { total: 100, tip: 0, service_fee: 0, paid: false });
  fixture.tables.order_adjustments = [{ id: "cancel", kind: "cancel", order_id: ORDER, restaurant_id: "r1", currency: null,
    previous_total: 100, previous_tip: 0, resulting_total: null, resulting_tip: null }];
  fixture.tables.refund_operations = [];
  expect((await read()).orders[0].total).toBe(100);
});
