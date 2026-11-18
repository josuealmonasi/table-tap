import { beforeEach, expect, it, vi } from "vitest";

const logged: { detail?: string | null }[] = [];
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null }) => void logged.push(e) }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));

import { setSuspension } from "@/lib/admin-suspend";

let row: Record<string, unknown>;
function fakeDb() {
  return {
    from() {
      const where: { col?: string; isNull?: boolean } = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q, eq: () => q,
        is: (col: string) => ((where.col = col), (where.isNull = true), q),
        not: (col: string) => ((where.col = col), (where.isNull = false), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        maybeSingle: async () => ({ data: row ? { ...row } : null, error: null }),
        then: (resolve: (v: unknown) => void) => {
          const holds = where.col === undefined || (where.isNull ? row[where.col] == null : row[where.col] != null);
          if (patch && holds) Object.assign(row, patch);
          resolve({ data: patch && holds ? [{ id: row.id }] : [], error: null });
        },
      };
      return q;
    },
  } as never;
}

beforeEach(() => { logged.length = 0; row = { id: "r1", suspended_at: null, suspended_reason: null, suspended_by: null }; });

it("suspends with the reason and who did it, and writes it in the restaurant's log", async () => {
  expect(await setSuspension(fakeDb(), "r1", { reason: "non_payment" }, "admin@x.dev")).toEqual({ ok: true });
  expect(row).toMatchObject({ suspended_reason: "non_payment", suspended_by: "admin@x.dev" });
  expect(row.suspended_at).toEqual(expect.any(String));
  expect(logged[0].detail).toContain("suspended=non_payment");
});

it("refuses to suspend twice, and to lift what is not suspended", async () => {
  await setSuspension(fakeDb(), "r1", { reason: "abuse" }, "a@x.dev");
  expect(await setSuspension(fakeDb(), "r1", { reason: "abuse" }, "a@x.dev")).toEqual({ ok: false, error: "apiErr.alreadySuspended", status: 409 });
  await setSuspension(fakeDb(), "r1", null, "a@x.dev");
  expect(row).toMatchObject({ suspended_at: null, suspended_reason: null, suspended_by: null });
  expect(await setSuspension(fakeDb(), "r1", null, "a@x.dev")).toEqual({ ok: false, error: "apiErr.notSuspended", status: 409 });
});

it("answers 404 for a restaurant that does not exist", async () => {
  row = null as never;
  expect(await setSuspension(fakeDb(), "nope", { reason: "other" }, "a@x.dev")).toEqual({ ok: false, error: "apiErr.restaurantNotFound", status: 404 });
});
