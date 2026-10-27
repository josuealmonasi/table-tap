import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { attackFeeCeiling } from "../../../scripts/attack-fees.mjs";

it("revokes the incremental fee writer from service_role as well as clients on schema reapplication", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  expect(sql).toContain("revoke all on function public.refund_platform_fee(uuid, text, integer, text) from public, anon, authenticated, service_role;");
  expect(sql).not.toMatch(/grant execute on function public\.refund_platform_fee\([^;]+to service_role;/);
  expect(readFileSync("supabase/drop.sql", "utf8"))
    .toContain("drop function if exists public.refund_platform_fee(uuid, text, integer, text);");
});

interface Fee { fee_id: string; cents: number; refunded_cents: number; status: string }
async function runAttack(refusal: string | null, mutate = false) {
  const rows: Fee[] = [];
  const ok = vi.fn(), bad = vi.fn();
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "reserve_platform_fee") {
      if (args.p_cap_cents !== null && rows.length >= 2 || args.p_ref && rows.length >= 3) return { data: [], error: null };
      const fee = { fee_id: `fee${rows.length}`, cents: 300, refunded_cents: 0, status: "open" };
      rows.push(fee);
      return { data: [{ fee_id: fee.fee_id, fee_cents: 300 }], error: null };
    }
    if (name === "take_platform_fee") rows[0].status = "taken";
    if (name === "refund_platform_fee") {
      if (mutate || !refusal) rows[0].refunded_cents = 150;
      return { data: !refusal, error: refusal ? { code: refusal, message: "refused" } : null };
    }
    return { data: true, error: null };
  });
  const admin = {
    rpc,
    from: () => {
      let id: unknown;
      const q = {
        select: () => q, eq: (key: string, value: unknown) => { if (key === "id") id = value; return q; },
        neq: () => q, delete: () => q, in: () => q,
        single: async () => ({ data: rows.find(r => r.fee_id === id), error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  };
  await attackFeeCeiling({ admin, home: { id: "r1" }, ok, bad });
  return { ok, bad, rpc };
}

it("keeps four attack verdicts and accepts only permission denial with no ledger change", async () => {
  const { ok, bad, rpc } = await runAttack("42501");
  expect(bad).not.toHaveBeenCalled();
  expect(ok).toHaveBeenCalledTimes(4);
  expect(ok).toHaveBeenCalledWith("the retired incremental fee refund cannot be called or change the ledger");
  expect(rpc.mock.calls.filter(([name]) => name === "refund_platform_fee")).toHaveLength(1);
});

it.each([null, "ECONNRESET"])("fails the retired-writer attack for %s instead of a permission denial", async code => {
  const { ok, bad } = await runAttack(code);
  expect(ok).toHaveBeenCalledTimes(3);
  expect(bad).toHaveBeenCalledOnce();
});

it("fails even a permission denial if the ledger changed", async () => {
  const { bad } = await runAttack("42501", true);
  expect(bad).toHaveBeenCalledOnce();
});
