import { beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import type Stripe from "stripe";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

// A second phone paying the whole bill while another phone's page is open
// used to get a generic 502 "Checkout failed".
const { rpc, resolve, release, create } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn(), release: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
vi.mock("@/lib/split-slots-attempt", () => ({ prepareSplitSlots: async () => {} }));
vi.mock("@/lib/diner-checkout", () => ({ recordDinerCheckout: async () => {}, stripeLiveMode: () => false }));
vi.mock("@/lib/platform-fee", () => ({ releaseFee: release, stripeRefusedOutright: () => false }));
const { openDinerAttempt, DinerAttemptRejected, DinerScopeBusy } = await import("@/lib/diner-attempt");
const params = { mode: "payment", metadata: { fee_id: "fee" } } as Stripe.Checkout.SessionCreateParams;
const quote = { restaurantId: "r1", stripeAccount: "acct_1", currency: "MXN", amountCents: 10000,
  orderIds: ["o1"], payableIds: ["o1"], scopeKey: "bill:o1:member-b", foodPrincipal: 100 };
const stripe = { checkout: { sessions: { create } } } as unknown as Stripe;
beforeEach(() => { vi.clearAllMocks(); resolve.mockResolvedValue("open"); });

it("a busy scope is refused as DinerScopeBusy, still a rejection that releases the fee", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "checkout_scope_busy", code: "P0001" } });
  const refusal = openDinerAttempt(stripe, params, quote);
  await expect(refusal).rejects.toBeInstanceOf(DinerScopeBusy);
  await expect(refusal).rejects.toBeInstanceOf(DinerAttemptRejected);
  expect(release).toHaveBeenCalledWith("fee");
  expect(create).not.toHaveBeenCalled();
});

it("any other SQL refusal stays a plain rejection", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "checkout_scope_changed", code: "P0001" } });
  const refusal = openDinerAttempt(stripe, params, quote);
  await expect(refusal).rejects.toBeInstanceOf(DinerAttemptRejected);
  await expect(refusal).rejects.not.toBeInstanceOf(DinerScopeBusy);
});

it("the bill route answers a busy scope with 409 billBeingPaid, and the phone shows that message", () => {
  const route = fs.readFileSync("src/app/api/bill/pay/route.ts", "utf8");
  expect(route).toContain('if (err instanceof DinerScopeBusy) return await apiError("apiErr.billBeingPaid", 409);');
  expect(fs.readFileSync("src/hooks/useBillPayment.ts", "utf8")).toContain('toast(data.error ?? t("done.networkError"), "error");');
  expect(es.apiErr.billBeingPaid).toBe("Alguien de la mesa ya está pagando la cuenta. Espera a que termine o pídele que la cancele.");
  expect(en.apiErr.billBeingPaid).toBe("Someone at the table is already paying the bill. Wait for them to finish or ask them to cancel it.");
});
