import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { auditedOwnerView } from "@/lib/admin-owner-view";

const db = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), findRestaurant: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: db.from }) }));
vi.mock("@/lib/setup-steps-server", () => ({ restaurantSetup: vi.fn() }));

const admin = { userId: "admin", email: "admin@example.invalid" };
const restaurantId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  db.insert.mockResolvedValue({ error: null });
  db.findRestaurant.mockResolvedValue({ data: null, error: null });
  db.from.mockImplementation(table => {
    if (table === "platform_admin_audit") return { insert: db.insert };
    if (table === "restaurants") return { select: () => ({ eq: () => ({ maybeSingle: db.findRestaurant }) }) };
    throw new Error(`Unexpected table ${table}`);
  });
});

const page = readFileSync("src/app/dashboard/admin/restaurants/[id]/page.tsx", "utf8");
const view = readFileSync("src/components/dashboard/admin/AdminOwnerView.tsx", "utf8");
const read = readFileSync("src/lib/admin-owner-view.ts", "utf8");
const sql = readFileSync("supabase/schema.sql", "utf8");

it("checks the platform admin before the audited read", () => {
  const guard = page.indexOf("if (!admin) redirect(");
  expect(guard).toBeGreaterThan(0);
  expect(page.indexOf("await auditedOwnerView(")).toBeGreaterThan(guard);
  expect(sql).toMatch(/'restaurant\.owner_transfer', 'restaurant\.view'\)\);/);
});

it("stops before checking whether the restaurant exists if the audit start fails", async () => {
  db.insert.mockResolvedValueOnce({ error: { message: "audit unavailable" } });
  await expect(auditedOwnerView(admin, restaurantId)).resolves.toEqual({ audited: false });
  expect(db.from.mock.calls).toEqual([["platform_admin_audit"]]);
});

it("audits a missing restaurant as a refused read after the attempted visit", async () => {
  await expect(auditedOwnerView(admin, restaurantId)).resolves.toEqual({ audited: true, view: null });
  expect(db.from.mock.calls).toEqual([["platform_admin_audit"], ["restaurants"], ["platform_admin_audit"]]);
  const [start, result] = db.insert.mock.calls.map(([row]) => row);
  expect(start).toMatchObject({ action: "restaurant.view", target_id: restaurantId, outcome: "started" });
  expect(result).toMatchObject({ attempt_id: start.attempt_id, target_id: restaurantId, outcome: "refused" });
});

it("withholds the result if the completion audit fails", async () => {
  db.insert.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "audit unavailable" } });
  await expect(auditedOwnerView(admin, restaurantId)).resolves.toEqual({ audited: false });
});

it("is read only: no write in the loader, no control on the screen", () => {
  expect(read).not.toMatch(/\.(update|upsert|delete|rpc)\(/);
  expect(read.match(/\.insert\(/g)?.length).toBe(1);
  expect(read).toContain('from("platform_admin_audit").insert(');
  expect(view).not.toMatch(/<button|<form|onClick|fetch\(|useAdminActions/);
});
