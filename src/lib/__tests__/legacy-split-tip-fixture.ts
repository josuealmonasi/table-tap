import { vi } from "vitest";
import type Stripe from "stripe";

const state = vi.hoisted(() => ({
  principal: null as number | null,
  prior: null as { url: string; metadata: { settle_tip: string }; amount_total: number } | null,
  open: vi.fn(async (_stripe: unknown, params: Stripe.Checkout.SessionCreateParams) => ({
    url: "https://checkout.invalid/share", metadata: params.metadata,
    amount_total: params.line_items?.[0].price_data?.unit_amount,
  })),
  reserve: vi.fn(async () => ({ id: "fee", cents: 10 })),
}));
export { state };
const orders = [{ id: "food", total: 120, tip: 20, service_fee: 0, currency: "MXN", paid: false,
  diner: "member", created_at: "2026-10-20T10:00:00Z", items: [] }];
vi.mock("stripe", () => ({ default: class {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "member" }) }));
vi.mock("@/lib/table-session", () => ({ staffOpenedBill: async () => false }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: { order_fee: 0.75 } }) }));
vi.mock("@/lib/platform-fee", () => ({ NO_FEE: { id: null, cents: 0 }, feeMetadata: () => ({}),
  reserveFeeCents: state.reserve, releaseFee: async () => {} }));
vi.mock("@/lib/diner-attempt", () => ({ resumeDinerAttempt: async () => state.prior, openDinerAttempt: state.open }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => orders }));
vi.mock("@/lib/diner-checkout-orders", () => ({ dinerCheckoutOrders: async () => orders }));
vi.mock("@/lib/table-bill", () => ({ tableBill: () => ({ total: 120 }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const data = table === "restaurants" ? { id: "restaurant", name: "Cafe", stripe_account_id: "acct", stripe_charges_enabled: true }
    : table === "bill_splits" ? { id: "split", status: "locked", session_id: "session", restaurant_id: "restaurant",
      amount: 120, shares: 2, food_principal: state.principal, order_ids: ["food"], locked_at: "2026-10-20T11:00:00Z" }
    : table === "bill_split_claims" ? { share_no: 0, amount: 60, paid_at: null } : { id: "session" };
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }),
    single: async () => ({ data, error: null }) };
  return q;
} }) }));
