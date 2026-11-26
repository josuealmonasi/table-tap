import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

// The real audit wrapper, over a fake database: a note is written only after
// the audit's "started" row, and the audit never copies the note's text.
const audit: Record<string, unknown>[] = [];
const notes: Record<string, unknown>[] = [];
let auditDown = false;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => ({ userId: "11111111-1111-4111-8111-111111111111", email: "admin@test.dev" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    let inserted: Record<string, unknown> | undefined;
    const q = {
      select: () => q, eq: () => q, order: () => q, limit: () => q,
      maybeSingle: async () => ({ data: table === "restaurants" ? { id: ID, name: "Cafe", plan: "carta", plan_status: "active", owner_id: null } : null, error: null }),
      insert: (value: Record<string, unknown>) => { inserted = value; return q; },
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "platform_admin_audit" && inserted) {
          if (auditDown) return Promise.resolve({ error: { message: "unavailable" } }).then(resolve);
          audit.push(inserted);
        }
        if (table === "restaurant_admin_notes" && inserted) notes.push(inserted);
        if (table === "restaurant_admin_notes" && !inserted) {
          // The read happens only after its audit row: checked here, at the read.
          readAfter.push(audit.map(row => row.outcome).join(","));
          return Promise.resolve({ data: notes, error: null }).then(resolve);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return q;
  },
}) }));

const ID = "33333333-3333-4333-8333-333333333333";
const readAfter: string[] = [];
const { GET, POST } = await import("../route");
const add = (text: string) => POST(new NextRequest("https://test.dev/api/admin/restaurants/notes", {
  method: "POST", body: JSON.stringify({ id: ID, body: text }),
}));

beforeEach(() => { audit.length = 0; notes.length = 0; readAfter.length = 0; auditDown = false; });

it("records a restaurant.note audit before the note, naming the restaurant and never the text", async () => {
  const response = await add("Owner called about a refund: card ending 4242");
  expect(response.status).toBe(200);
  expect(notes).toHaveLength(1);
  expect(audit.map(row => row.outcome)).toEqual(["started", "succeeded"]);
  expect(audit[0]).toMatchObject({ action: "restaurant.note", target_type: "restaurant", target_id: ID });
  expect(JSON.stringify(audit)).not.toContain("4242");
  expect(JSON.stringify(audit)).not.toContain("refund");
});

it("saves no note while the audit stream is down", async () => {
  auditDown = true;
  const response = await add("A note");
  expect(response.status).toBe(503);
  expect(notes).toEqual([]);
});

it("is an action the database's audit check accepts", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const check = sql.split("add constraint platform_admin_audit_action_check").at(-1)?.split(";")[0] ?? "";
  expect(check).toContain("'restaurant.note'");
});

// Admin recheck: the notes were read with no platform_admin_audit row.
const read = () => GET(new NextRequest(`https://test.dev/api/admin/restaurants/notes?id=${ID}`));

it("audits a restaurant.view (notes) before reading, and never copies a note's text", async () => {
  notes.push({ restaurant_id: ID, author: "a@test.dev", body: "Owner disputes charge 4242" });
  const response = await read();
  expect(response.status).toBe(200);
  expect((await response.json()).notes).toHaveLength(1);
  expect(readAfter).toEqual(["started"]);
  expect(audit.map(row => row.outcome)).toEqual(["started", "succeeded"]);
  expect(audit[0]).toMatchObject({ action: "restaurant.view", target_type: "restaurant", target_id: ID,
    after_facts: { read_only: true, view: "notes" } });
  expect(JSON.stringify(audit)).not.toContain("4242");
});

it("reads no notes while the audit stream is down", async () => {
  auditDown = true;
  notes.push({ restaurant_id: ID, author: "a@test.dev", body: "secret" });
  const response = await read();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "apiErr.adminAuditUnavailable" });
  expect(readAfter).toEqual([]);
});

it("restaurant.view is an action the database's audit check accepts", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const check = sql.split("add constraint platform_admin_audit_action_check").at(-1)?.split(";")[0] ?? "";
  expect(check).toContain("'restaurant.view'");
});
