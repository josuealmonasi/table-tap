import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const page = readFileSync("src/app/dashboard/admin/restaurants/[id]/page.tsx", "utf8");
const view = readFileSync("src/components/dashboard/admin/AdminOwnerView.tsx", "utf8");
const read = readFileSync("src/lib/admin-owner-view.ts", "utf8");
const sql = readFileSync("supabase/schema.sql", "utf8");

it("checks the platform admin, then records the visit, then reads", () => {
  const guard = page.indexOf("if (!admin) redirect(");
  const record = page.indexOf("await recordOwnerView(");
  const load = page.indexOf("await readOwnerView(");
  expect(guard).toBeGreaterThan(0);
  expect(record).toBeGreaterThan(guard);
  expect(load).toBeGreaterThan(record);
  expect(sql).toMatch(/'restaurant\.owner_reset',\s*'restaurant\.view'\)\);/);
});

it("is read only: no write in the loader, no control on the screen", () => {
  expect(read).not.toMatch(/\.(update|upsert|delete|rpc)\(/);
  expect(read.match(/\.insert\(/g)?.length).toBe(1);
  expect(read).toContain('from("platform_admin_audit").insert(');
  expect(view).not.toMatch(/<button|<form|onClick|fetch\(|useAdminActions/);
});
