import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Low fixes 2026-11-25 #1 and #2: staff emails were stored as typed while the
 * log names people by their login's lowercase address, so a removal reset
 * found nothing for "Ana@Example.com"; and only the newest 1,000 log rows
 * were read.
 */
const id = (n: number) => `6b1f0c2e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = vi.hoisted(() => ({
  created: "", inserted: {} as Record<string, unknown>, invited: "",
  logs: [] as { actor_email: string; detail: string }[], pattern: "", ranges: [] as number[][],
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  auth: { admin: {
    createUser: async ({ email }: { email: string }) => { state.created = email; return { data: { user: { id: "u" } }, error: null }; },
    inviteUserByEmail: async (email: string) => { state.invited = email; return { data: { user: { id: "u" } }, error: null }; },
    deleteUser: async () => ({ error: null }),
  } },
  from: () => {
    let from = 0, to = 0;
    const q: Record<string, unknown> = {};
    for (const key of ["select", "eq", "order"]) q[key] = () => q;
    q.insert = async (row: Record<string, unknown>) => { state.inserted = row; return { error: null }; };
    q.ilike = (_: string, pattern: string) => { state.pattern = pattern; return q; };
    q.range = (a: number, b: number) => { from = a; to = b; state.ranges.push([a, b]); return q; };
    // ILIKE as PostgreSQL reads it: case-insensitive, with \ escaping.
    const matches = (value: string) => value.toLowerCase() === state.pattern.replace(/\\(.)/g, "$1").toLowerCase();
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
      data: state.logs.filter(l => matches(l.actor_email)).slice(from, to + 1), error: null,
    }).then(resolve);
    return q;
  },
}) }));
const { inviteStaff } = await import("@/lib/staff-invite");
const { accountsOpenedBy } = await import("@/lib/staff-removal");
beforeEach(() => { state.logs = []; state.pattern = ""; state.ranges = []; });

it("stores an invited address the way the login stores it: trimmed and lowercase", async () => {
  expect(await inviteStaff("r", "  Ana.Lopez@Example.COM ", "waiter", "https://test")).toBeNull();
  expect(state.created).toBe("ana.lopez@example.com");
  expect(state.inserted.email).toBe("ana.lopez@example.com");
  expect(state.invited).toBe("ana.lopez@example.com");
  expect(readFileSync("src/app/api/staff/route.ts", "utf8")).toContain("normalizeEmail(body.email)");
});

it("finds the links a mixed-case staff row opened, and nobody else's", async () => {
  state.logs = [
    { actor_email: "ana@example.com", detail: `name=A link=${id(1)}` },
    { actor_email: "anaxexample.com", detail: `name=B link=${id(2)}` },
  ];
  // An underscore in an address is a wildcard to ILIKE unless escaped.
  expect(await accountsOpenedBy("r", "Ana@Example.com")).toEqual([id(1)]);
  state.logs.push({ actor_email: "a_b@example.com", detail: `name=C link=${id(3)}` }, { actor_email: "axb@example.com", detail: `name=D link=${id(4)}` });
  expect(await accountsOpenedBy("r", "A_B@example.com")).toEqual([id(3)]);
});

it("reads every log row, past the first thousand", async () => {
  state.logs = Array.from({ length: 1001 }, (_, n) => ({ actor_email: "ana@example.com", detail: `link=${id(n)}` }));
  const ids = await accountsOpenedBy("r", "ana@example.com");
  expect(ids).toHaveLength(1001);
  expect(ids).toContain(id(1000));
  expect(state.ranges.length).toBeGreaterThan(1);
});
