import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { fixture } from "./fixtures";

it("purges only expired archives whose restaurant no longer exists", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.split("create or replace function public.purge_expired_accounting_records()").at(-1)?.split("$$;")[0] ?? "";
  expect(body).toMatch(/r\.retained_at\s*<\s*now\(\)\s*-\s*interval '10 years'/i);
  expect(body).toMatch(/limit\s+1000\s+for update skip locked/i);
  expect(body).toMatch(/security definer set search_path = public/i);
  expect(sql).toContain("revoke all on function public.purge_expired_accounting_records() from public, anon, authenticated;");
  expect(sql).toContain("grant execute on function public.purge_expired_accounting_records() to service_role;");
  expect(sql).not.toMatch(/restaurant_accounting_records (?:add column if not exists|set) deleted_at/i);
});

it("excludes live restaurants from deletion and pending counts", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.split("create or replace function public.purge_expired_accounting_records()").at(-1)?.split("$$;")[0] ?? "";
  expect(body.match(/not exists \(select 1 from restaurants x where x\.id = r\.restaurant_id\)/gi)).toHaveLength(2);
});

it("reports pending age from when the retention period ended", async () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const body = sql.split("create or replace function public.purge_expired_accounting_records()").at(-1)?.split("$$;")[0] ?? "";
  expect(body).toMatch(/min\(r\.retained_at \+ interval '10 years'\)/i);
  const { purgeAccounting } = await import("../accounting-purge");
  const f = fixture();
  f.rpc.mockResolvedValue({ data: { deleted: 1000, pending: 1, oldest: new Date(Date.now() - 60000).toISOString() }, error: null });
  expect(await purgeAccounting(f.context)).toMatchObject({ pending: 1, oldest_pending_age_seconds: 60, age_basis: "retention_expired_at" });
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
