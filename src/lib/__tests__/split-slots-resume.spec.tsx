// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SplitState } from "@/hooks/useSplit";
import { translate, messagesFor } from "@/lib/i18n";

const s = vi.hoisted(() => ({
  attempt: null as Record<string, unknown> | null, held: false, lost: true,
  creates: [] as unknown[][], retrieves: 0, fees: 0, locale: "es" as "es" | "en",
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(s.locale), key, vars) }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => [] }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/site-origin", () => ({ siteOrigin: () => "http://localhost" }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/platform-fee", () => ({ NO_FEE: {}, reserveFeeCents: async () => { s.fees++; return { id: "fee", cents: 150 }; },
  feeMetadata: () => ({ fee_id: "fee", fee_cents: "150" }), releaseFee: vi.fn(), stripeRefusedOutright: () => false }));
vi.mock("@/lib/diner-checkout", () => ({ stripeLiveMode: () => false, requireVerifiedCheckout: vi.fn(),
  recordDinerCheckout: async () => { s.attempt!.stripe_session_id = "cs"; } }));
vi.mock("stripe", () => ({ default: class {
  checkout = { sessions: {
    create: async (...args: unknown[]) => { s.creates.push(args); return { id: "cs", status: "open", url: "original-page" }; },
    retrieve: async () => { s.retrieves++; return { id: "cs", status: "open", url: "original-page" }; }, expire: vi.fn(),
  } };
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "diner_checkout_open") {
      s.attempt = { ...(args.p_record as object), status: "open", stripe_session_id: null };
      return { data: s.attempt, error: null };
    }
    if (name === "reserve_split_slots_v1") {
      const repeated = s.held; s.held = true;
      Object.assign(s.attempt!, { split_id: "split", payer_member_id: "m", split_revision: 1 });
      if (s.lost) return { data: null, error: { message: "reservation reply lost" } };
      return { data: { outcome: repeated ? "repeat" : "reserved", amount_cents: 10000, fee_cents: 300 }, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    function data() {
      if (table === "diner_checkouts") {
        const attempt = s.attempt;
        return attempt && Object.entries(filters).every(([key, value]) => attempt[key] === value) ? [attempt] : [];
      }
      if (table === "bill_split_slots") return [0, 1, 2].map(share_no => ({ share_no, amount_cents: 5000,
        fee_slice_cents: 150, payment_id: null, reserved_checkout_id: s.held && share_no < 2 ? s.attempt!.id : null })).filter(slot => !filters.share_no || (filters.share_no as number[]).includes(slot.share_no));
      if (table === "bill_splits") return [{ id: "split", model_version: 2, revision: 1, shares: 3, status: "locked",
        amount: 150, proposed_by: "m", currency: "MXN", order_ids: ["o"], food_principal: 150, first_payment_attempt_at: s.held ? "now" : null }];
      if (table === "restaurants") return [{ name: "Restaurant", stripe_account_id: "acct", stripe_charges_enabled: true }];
      return [{ id: "session" }];
    }
    const q: Record<string, unknown> = {};
    for (const op of ["select", "order", "in"]) q[op] = () => q;
    q.in = (key: string, value: unknown) => { if (key === "share_no") filters[key] = value; return q; };
    q.eq = (key: string, value: unknown) => { filters[key] = value; return q; };
    q.single = q.maybeSingle = async () => ({ data: data()[0] ?? null, error: null });
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve);
    return q;
  },
}) }));
const { paySplitSlots } = await import("@/lib/split-slots-pay");
const { currentSplit } = await import("@/lib/split-service");
const { default: SplitSlotsCard } = await import("@/components/customer/SplitSlotsCard");
const member = { id: "m", sessionId: "session", restaurantId: "r", tableId: "t", closed: false };
const body = { restaurantId: "r", tableId: "t", sessionId: "session", splitId: "split", revision: 1,
  slots: [0, 1], expectedCents: 10000, tipCents: 725 };
const request = () => new NextRequest("http://localhost/api/split/pay", { method: "POST" });
const read = (id = "m", restaurant = "r") => currentSplit("session", id, restaurant, "t", [], { ...member, id, restaurantId: restaurant });
let root: Root, el: HTMLDivElement;
beforeEach(() => {
  Object.assign(s, { attempt: null, held: false, lost: true, creates: [], retrieves: 0, fees: 0, locale: "es" });
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  el = document.createElement("div"); root = createRoot(el);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each([[false, "es"], [true, "es"], [false, "en"], [true, "en"]] as const)("continues the exact frozen parts and tip after a lost reply (provider page %s, %s)", async (openPage, locale) => {
  s.locale = locale;
  expect((await paySplitSlots(request(), body, member)).status).toBe(502);
  expect(s.held).toBe(true); expect(s.creates).toHaveLength(0); expect(s.fees).toBe(1);
  if (openPage) s.attempt!.stripe_session_id = "cs";
  const split = await read();
  expect(split?.slots?.slice(0, 2).every(slot => slot.paying)).toBe(true);
  let response: Response | undefined;
  const pay = vi.fn((slots?: number[], tipCents?: number) => {
    void paySplitSlots(request(), { ...body, slots, tipCents }, member).then(result => { response = result; });
  });
  await act(async () => root.render(<SplitSlotsCard split={split as SplitState} outstanding={150} diner="m" busy={false}
    cardsEnabled onPay={pay} cancel={async () => {}} />));
  const label = locale === "es" ? "Continuar el pago" : "Continue payment";
  const resume = [...el.querySelectorAll("button")].find(b => b.textContent === label);
  expect(resume).toBeDefined(); expect(resume!.disabled).toBe(false);
  expect(el.textContent).toContain("7.25");
  s.lost = false;
  await act(async () => { resume!.click(); });
  expect(pay).toHaveBeenCalledWith([0, 1], 725);
  expect(await response!.json()).toEqual({ url: "original-page" });
  expect(s.fees).toBe(1);
  expect(s.creates).toHaveLength(openPage ? 0 : 1); expect(s.retrieves).toBe(openPage ? 1 : 0);
  if (!openPage) expect(s.creates[0]).toEqual([s.attempt!.stripe_params,
    { stripeAccount: "acct", idempotencyKey: s.attempt!.idempotency_key }]);
  const other = await read("other");
  await act(async () => root.render(<SplitSlotsCard split={other as SplitState} outstanding={150} diner="other" busy={false}
    cardsEnabled onPay={vi.fn()} cancel={async () => {}} />));
  expect(el.textContent).not.toContain(label);
  expect(el.querySelectorAll("input[type=checkbox]:disabled")).toHaveLength(2);
  expect((await read("m", "foreign"))?.resumptions ?? []).toEqual([]);
});
