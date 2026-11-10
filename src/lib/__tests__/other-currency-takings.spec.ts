import { expect, it, vi } from "vitest";

const calls: { neq?: [string, string]; lte?: string }[] = [];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const call: { neq?: [string, string]; lte?: string } = {};
  calls.push(call);
  const q: Record<string, unknown> = {};
  for (const key of ["select", "eq", "gte", "order"]) q[key] = () => q;
  q.neq = (column: string, value: string) => { call.neq = [column, value]; return q; };
  q.lte = (_column: string, value: string) => { call.lte = value; return q; };
  // One page, then an empty one: everyRow reads until a page comes back empty.
  q.range = async (from: number) => ({ data: from > 0 ? [] : [
    { currency: "MXN", method: "cash", amount: 100 },
    { currency: "MXN", method: "card", amount: 40.5 },
    { currency: "MXN", method: "cash", amount: 20.25 },
  ], error: null });
  return q;
} }) }));

import { otherCurrencyTakings } from "@/lib/other-currency-takings";
import { otherCurrencyLines } from "@/lib/other-currency";

it("R8-3 lists an old peso debt collected in a dollar day apart, by method", async () => {
  const lines = await otherCurrencyTakings("r", "USD", "2026-11-09T06:00:00Z", "2026-11-09T20:00:00Z");
  expect(calls[0]).toEqual({ neq: ["currency", "USD"], lte: "2026-11-09T20:00:00Z" });
  expect(lines).toEqual([{ currency: "MXN", cash: 120.25, card: 40.5 }]);
  const t = (key: string, vars?: Record<string, string | number>) => `${key} ${JSON.stringify(vars)}`;
  expect(otherCurrencyLines(lines, t, (n, c) => `${c} ${n}`)).toEqual([
    'corte.otherCurrency {"currency":"MXN","cash":"MXN 120.25","card":"MXN 40.5"}',
  ]);
  expect(otherCurrencyLines(undefined, t, String)).toEqual([]);
});
