import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";

// Audit O finding 1: Stripe failed a refund it first reported as succeeded,
// and nothing listened, so the diner's money stayed shown as returned.
// Audit P: Stripe delivers events twice and out of order; SQL decides.
const state = vi.hoisted(() => ({
  restaurant: { id: "r1" } as { id: string } | null,
  rpcError: null as { message: string } | null,
  rpc: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: state.restaurant, error: null }) };
    return q;
  },
  rpc: async (name: string, args: unknown) => { state.rpc(name, args); return { data: "operation", error: state.rpcError }; },
}) }));
const { reopenFailedRefund, REFUND_FAILURE_EVENTS } = await import("@/lib/refunds/provider-failure");

const refund = (extra: Partial<Stripe.Refund> = {}) =>
  ({ id: "re_1", status: "failed", amount: 10050, currency: "mxn", payment_intent: "pi_1", ...extra }) as Stripe.Refund;
const sql = readFileSync("supabase/schema.sql", "utf8");
const body = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];
beforeEach(() => { state.restaurant = { id: "r1" }; state.rpcError = null; state.rpc.mockClear(); });

it("listens to every event a later failure arrives as", () => {
  expect([...REFUND_FAILURE_EVENTS].sort()).toEqual(["charge.refund.updated", "refund.failed", "refund.updated"]);
});
it.each([["mxn", "MXN"], ["usd", "USD"]])("reopens a failed %s refund on the account's own restaurant, with its amount", async (currency, code) => {
  await reopenFailedRefund(refund({ currency }), "acct_1");
  expect(state.rpc).toHaveBeenCalledWith("reverse_failed_refund_v2", {
    p_restaurant: "r1", p_intent: "pi_1", p_refund: "re_1", p_status: "failed", p_cents: 10050, p_currency: code,
  });
});
it("reads the charge from an expanded payment intent too", async () => {
  await reopenFailedRefund(refund({ status: "canceled", payment_intent: { id: "pi_2" } as Stripe.PaymentIntent }), "acct_1");
  expect(state.rpc.mock.calls[0][1]).toMatchObject({ p_intent: "pi_2", p_status: "canceled" });
});
it.each([
  ["a refund that succeeded", refund({ status: "succeeded" }), "acct_1"],
  ["a pending refund", refund({ status: "pending" }), "acct_1"],
  ["an event with no connected account", refund(), undefined],
  ["a refund with no charge", refund({ payment_intent: null }), "acct_1"],
])("ignores %s", async (_name, r, account) => {
  await reopenFailedRefund(r, account);
  expect(state.rpc).not.toHaveBeenCalled();
});
it("ignores an account that is no restaurant here", async () => {
  state.restaurant = null;
  await reopenFailedRefund(refund(), "acct_other");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("throws when the reversal fails, so Stripe sends the event again", async () => {
  state.rpcError = { message: "lock timeout" };
  await expect(reopenFailedRefund(refund(), "acct_1")).rejects.toThrow("lock timeout");
});

it("reverses once, under the money lock, scoped to the restaurant and charge, server only", () => {
  const reverse = body("reverse_failed_refund_v2");
  const lock = reverse.indexOf("lock_restaurant_money(p_restaurant)");
  expect(lock).toBeGreaterThan(0);
  expect(lock).toBeLessThan(reverse.indexOf("insert into refund_failures"));
  // A replay records nothing new and stops before touching any row or the log.
  expect(reverse.indexOf("if not v_first then return null; end if;")).toBeLessThan(reverse.indexOf("update "));
  for (const update of reverse.split(/\bupdate (?=refund_|user_)/).slice(1)) expect(update).toMatch(/restaurant_id = p_restaurant|where id = (v_attempt|o\.id|d\.id)/);
  expect(reverse).toContain("stripe_payment_intent = p_intent");
  expect(reverse).toContain("p_status not in ('failed', 'canceled')");
  for (const fn of ["reverse_failed_refund_v2(uuid, text, text, text, int, text)", "reverse_failed_refund(uuid, text, text, text)",
    "verify_refunded_platform_fee_v2(uuid, text, int, int, text[], int)", "refund_fee_epoch(uuid, text)"]) {
    expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
    expect(sql).toContain(`grant execute on function public.${fn} to service_role;`);
  }
});
it("audit P 1: only the latest attempt's refund reopens a row; an old attempt's failure cannot undo a retry", () => {
  const reverse = body("reverse_failed_refund_v2");
  expect(reverse).toContain("if v_latest = v_attempt and o.status in ('succeeded', 'processing') then");
  expect(reverse).toContain("if v_latest = v_attempt and d.refunded_at is not null then");
});
it("audit P 1 / Q 2: a success read after its own failure records the failure on the attempt and never completes", () => {
  for (const fn of ["finish_refund_operation", "finish_refund_due_attempt"]) {
    const finish = body(fn);
    const known = finish.indexOf("from refund_failures f where f.restaurant_id = p_restaurant and f.stripe_refund_id = p_refund");
    expect(known, fn).toBeGreaterThan(0);
    expect(known, fn).toBeLessThan(finish.indexOf("update refund"));
    expect(finish, fn).toContain("if v_failed is not null then p_status := v_failed; end if;");
  }
  // Recorded, but not completed: the caller must not read it as done.
  expect(body("finish_refund_operation")).toContain("return v_failed is null;");
  expect(body("finish_refund_due_attempt")).toContain("if p_status <> 'succeeded' then return false; end if;");
});
it("audit Q 1: a row completed before attempts existed is matched by its own refund id", () => {
  const reverse = body("reverse_failed_refund_v2");
  expect(reverse).toContain("not exists (select 1 from refund_attempts a where a.operation_id = r.id)");
  expect(reverse).toContain("not exists (select 1 from refund_due_attempts a where a.due_id = r.id)");
});
it("audit Q 3: the kept unversioned verifier refuses once a charge has seen a failure; the write itself is granted to no one", () => {
  const legacy = body("verify_refunded_platform_fee");
  expect(legacy.indexOf("lock_restaurant_money(p_restaurant)")).toBeLessThan(legacy.indexOf("refund_fee_epoch("));
  expect(legacy).toContain("if public.refund_fee_epoch(p_restaurant, p_intent) > 0 then return; end if;");
  expect(body("verify_refunded_platform_fee_v2")).toContain("perform public.apply_verified_platform_fee(");
  expect(sql).toContain("revoke all on function public.apply_verified_platform_fee(uuid, text, int, int, text[]) from public, anon, authenticated;");
  expect(sql).not.toMatch(/grant execute on function public\.apply_verified_platform_fee/);
});
it("audit Q 4: a provisional duplicate-charge fee target is saved only under the current epoch, and only raised", () => {
  const save = body("save_refund_due_fee_target");
  expect(save.indexOf("lock_restaurant_money(p_restaurant)")).toBeLessThan(save.indexOf("update refunds_due"));
  expect(save).toContain("if p_epoch is null or p_epoch <> public.refund_fee_epoch(p_restaurant, d.stripe_payment_intent) then return false; end if;");
  expect(save).toContain("fee_target_cents = greatest(coalesce(fee_target_cents, 0), p_target)");
  expect(sql).toContain("grant execute on function public.save_refund_due_fee_target(uuid, uuid, int, int) to service_role;");
  const recovery = readFileSync("src/lib/refunds/due-recovery.ts", "utf8");
  const reconciler = readFileSync("src/lib/refunds/charge-reconciler.ts", "utf8");
  expect(reconciler.indexOf('rpc("refund_fee_epoch"')).toBeLessThan(reconciler.indexOf("client.paymentIntents.retrieve("));
  expect(recovery).not.toContain('.update({ fee_target_cents');
});
it("audit P 2: a failure moves the charge's fee epoch on, and a verification read under an older one is refused", () => {
  expect(body("reverse_failed_refund_v2")).toContain("do update set epoch = refund_fee_epochs.epoch + 1");
  const v2 = body("verify_refunded_platform_fee_v2");
  expect(v2.indexOf("lock_restaurant_money(p_restaurant)")).toBeLessThan(v2.indexOf("refund_fee_epoch(p_restaurant, p_intent)"));
  expect(v2).toContain("if p_epoch is null or p_epoch <> public.refund_fee_epoch(p_restaurant, p_intent) then return false; end if;");
});
it("audit P 6: the owner's activity line is written by the same transaction as the reversal", () => {
  const reverse = body("reverse_failed_refund_v2");
  expect(reverse).toContain("insert into user_logs (restaurant_id, actor_email, entity, action, detail)");
  expect(reverse).toContain("'refund_failed'");
  expect(readFileSync("src/lib/refunds/provider-failure.ts", "utf8")).not.toContain("logEvent");
});
it("drops everything it adds", () => {
  const drop = readFileSync("supabase/drop.sql", "utf8");
  for (const line of ["drop function if exists public.reverse_failed_refund_v2(uuid, text, text, text, int, text);",
    "drop function if exists public.verify_refunded_platform_fee_v2(uuid, text, int, int, text[], int);",
    "drop function if exists public.refund_fee_epoch(uuid, text);",
    "drop function if exists public.apply_verified_platform_fee(uuid, text, int, int, text[]);",
    "drop function if exists public.save_refund_due_fee_target(uuid, uuid, int, int);",
    "drop table if exists refund_failures cascade;", "drop table if exists refund_fee_epochs cascade;"]) expect(drop).toContain(line);
});

it("audit R 1: the first attempt of a refund completed before attempts existed carries that refund", () => {
  const start = body("start_refund_attempt");
  expect(start).toContain("case when a.id is null and o.status = 'succeeded' then o.stripe_refund_id end");
  expect(start).toContain("case when a.id is null and o.status = 'succeeded' then 'succeeded' end");
});
it("audit R 2: a fee request's amount is accepted only under the epoch it was read in; the writes are granted to no one", () => {
  for (const [fn, args] of [["start_refund_due_fee", "uuid, uuid, text, int"], ["advance_refund_due_fee", "uuid, uuid, jsonb, int, int, int, text"]]) {
    const v2 = body(`${fn}_v2`);
    expect(v2.indexOf("lock_restaurant_money(p_restaurant)"), fn).toBeLessThan(v2.indexOf("refund_fee_epoch("));
    expect(v2, fn).toContain("if p_epoch is null or p_epoch <> public.refund_fee_epoch(");
    expect(body(fn), fn).toMatch(/if public\.refund_fee_epoch\([^;]*\) > 0 then return null; end if;/);
    expect(sql, fn).toContain(`revoke all on function public.${fn}_apply(${args}) from public, anon, authenticated;`);
    expect(sql, fn).not.toMatch(new RegExp(`grant execute on function public\\.${fn}_apply`));
    expect(sql, fn).toContain(`grant execute on function public.${fn}_v2(${args}, int) to service_role;`);
  }
  const recovery = readFileSync("src/lib/refunds/due-recovery.ts", "utf8");
  expect(recovery).toContain("await syncReturnedFee(");
  expect(recovery).not.toMatch(/rpc\("(?:start|advance)_refund_due_fee_v2/);
  expect(recovery).not.toMatch(/rpc\("(start|advance)_refund_due_fee"/);
});
