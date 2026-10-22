import { expect, it, vi } from "vitest";
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
import { existingTicket } from "@/lib/pos-sale";
import { orderRequestScope } from "@/lib/order-request";
import type { createAdminClient } from "@/lib/supabase/admin";
const body = { method: "account" as const, accountId: "tab", items: [{ itemId: "milk", name: "Milk", price: 100, emoji: "", qty: 1, mods: {} }] };
function db(scope: string | null = orderRequestScope("pos-account", body)) {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ error: null,
    data: { id: "ticket", total: 100, currency: "MXN", status: "received", paid: false,
      account_id: "tab", charged_at: "now", request_scope: scope } }) };
  return { from: () => q } as unknown as ReturnType<typeof createAdminClient>;
}
it.each([
  { ...body, accountId: "other" }, { ...body, items: [{ ...body.items[0], qty: 2 }] },
])("L4 an account reference cannot answer with another account or meal", async changed => {
  const response = await existingTicket(db(), "ref", "restaurant", changed);
  expect(response?.status).toBe(409);
  expect(await response?.json()).toEqual({ error: "apiErr.retryConflict" });
});
it("L4 an unchanged account sale recovers its saved ticket", async () => {
  const response = await existingTicket(db(), "ref", "restaurant", body);
  expect(await response?.json()).toMatchObject({ orderId: "ticket", repeat: true, settled: true });
});
it("L6 display edits and object-key order do not change the requested meal", () => {
  expect(orderRequestScope("counter", body)).toBe(orderRequestScope("counter", {
    ...body, items: [{ ...body.items[0], name: "New menu label", price: 120 }],
  }));
});
it("batch 5 cross-review 3: a sale rung before the deploy, with no saved request, replays on its account", async () => {
  // The tills in production forget a reference on a 409; refusing this
  // unchanged retry rang the MX$100 account sale a second time.
  const response = await existingTicket(db(null), "ref", "restaurant", body);
  expect(await response?.json()).toMatchObject({ orderId: "ticket", repeat: true });
  // Another account is still refused, as it was before the request was saved.
  expect((await existingTicket(db(null), "ref", "restaurant", { ...body, accountId: "other" }))?.status).toBe(409);
});
