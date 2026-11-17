import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { fixture } from "./fixtures";

it("purges only archives more than ten years old in a bounded recovery call", async () => {
  const { purgeAccounting } = await import("../accounting-purge");
  const f = fixture();
  const rows = ["2016-11-16T00:00:00Z", "2016-11-17T00:00:00Z", "2016-11-18T00:00:00Z"];
  f.rpc.mockImplementation(async () => {
    const expired = rows.filter(date => date < "2016-11-17T00:00:00Z");
    rows.splice(0, expired.length);
    return { data: { deleted: expired.length, pending: 0, oldest: null }, error: null };
  });
  expect(await purgeAccounting(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(rows).toEqual(["2016-11-17T00:00:00Z", "2016-11-18T00:00:00Z"]);
  expect(f.rpc).toHaveBeenCalledWith("purge_expired_accounting_records", {});
});

it("keeps the deletion boundary, batch limit and service-only SQL together", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.split("create or replace function public.purge_expired_accounting_records()")[1]?.split("$$;")[0] ?? "";
  expect(body).toMatch(/deleted_at\s*<\s*now\(\)\s*-\s*interval '10 years'/i);
  expect(body).toMatch(/limit\s+\d+/i);
  expect(body).toMatch(/security definer set search_path = public/i);
  expect(sql).toContain("revoke all on function public.purge_expired_accounting_records() from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.purge_expired_accounting_records() to service_role;");
  expect(sql).toMatch(/delete from restaurants where id = p_restaurant;\s*update restaurant_accounting_records set deleted_at = clock_timestamp\(\)/i);
});

it("reports database errors and refuses to start after the recovery deadline", async () => {
  const { purgeAccounting } = await import("../accounting-purge");
  const f = fixture();
  f.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
  await expect(purgeAccounting(f.context)).rejects.toThrow("database unavailable");
  f.rpc.mockClear();
  f.context.deadline = Date.now();
  await expect(purgeAccounting(f.context)).rejects.toThrow("deadline");
  expect(f.rpc).not.toHaveBeenCalled();
});

it("rejects a missing or inconsistent remaining count", async () => {
  const { purgeAccounting } = await import("../accounting-purge");
  const f = fixture();
  f.rpc.mockResolvedValue({ data: { deleted: 1, pending: 1, oldest: null }, error: null });
  await expect(purgeAccounting(f.context)).rejects.toThrow("Invalid accounting purge result");
});
