import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("C7: table and atomic writer accept bounded signed bank amounts", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  expect(sql.includes("drop constraint if exists terminal_deposits_received_check")).toBe(true);
  expect(sql.includes("check (received between -100000000 and 100000000)")).toBe(true);
  expect(sql.includes("check (expected between -100000000 and 100000000)")).toBe(true);
  expect(sql.includes("drop constraint if exists terminal_deposits_expected_check")).toBe(true);
  const writer = sql.split("create or replace function public.record_terminal_deposit_v1(")[1].split("$$;")[0];
  expect(writer).not.toContain("p_received < 0");
  expect(writer).toContain("p_received < -100000000 or p_received > 100000000");
  expect(writer).toContain("snapshot_at, payment_ids, return_ids, fee_pct");
});
