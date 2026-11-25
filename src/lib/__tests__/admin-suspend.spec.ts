import { beforeEach, expect, it, vi } from "vitest";

const logged: { detail?: string | null }[] = [];
vi.mock("@/lib/activity-log", () => ({ logEvent: async (e: { detail?: string | null }) => void logged.push(e) }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));

import { setSuspension } from "@/lib/admin-suspend";

let row: Record<string, unknown>;
// Runs once after the read: another admin acting between this request's read and write.
let between: (() => void) | null = null;
function fakeDb() {
  return {
    from() {
      const where: { col?: string; isNull?: boolean; equals?: unknown } = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        eq: (col: string, value: unknown) => (col === "id" ? q : ((where.col = col), (where.equals = value), q)),
        is: (col: string) => ((where.col = col), (where.isNull = true), q),
        not: (col: string) => ((where.col = col), (where.isNull = false), q),
        update: (p: Record<string, unknown>) => ((patch = p), q),
        maybeSingle: async () => {
          const data = row ? { ...row } : null;
          between?.(); between = null;
          return { data, error: null };
        },
        then: (resolve: (v: unknown) => void) => {
          const holds = where.col === undefined ? true
            : "equals" in where ? row[where.col] === where.equals
              : where.isNull ? row[where.col] == null : row[where.col] != null;
          if (patch && holds) Object.assign(row, patch);
          resolve({ data: patch && holds ? [{ id: row.id }] : [], error: null });
        },
      };
      return q;
    },
  } as never;
}

beforeEach(() => { logged.length = 0; between = null; row = { id: "r1", suspended_at: null, suspended_reason: null, suspended_by: null }; });

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

const A = "2026-11-25T10:00:00.123456+00:00";
const B = "2026-11-25T10:05:00.654321+00:00";
const suspendedAt = (at: string, reason = "abuse") => ({ id: "r1", suspended_at: at, suspended_reason: reason, suspended_by: "a@x.dev" });

it("a delayed lift does not clear a newer suspension applied after its read (review bl26, finding 6)", async () => {
  row = suspendedAt(A);
  // Another admin lifts A and applies B while this lift is in flight.
  between = () => Object.assign(row, suspendedAt(B, "non_payment"));
  expect(await setSuspension(fakeDb(), "r1", null, "slow@x.dev")).toEqual({ ok: false, error: "apiErr.suspensionChangedMeanwhile", status: 409 });
  expect(row).toMatchObject({ suspended_at: B, suspended_reason: "non_payment" });
  expect(logged).toEqual([]);
});

it("a lift for the suspension the admin saw refuses a different one, and lifts the one it saw", async () => {
  row = suspendedAt(B);
  expect(await setSuspension(fakeDb(), "r1", null, "a@x.dev", "2026-11-25T10:00:00.123Z")).toEqual({ ok: false, error: "apiErr.suspensionChangedMeanwhile", status: 409 });
  expect(row.suspended_at).toBe(B);
  // The same instant in another notation is the same suspension.
  expect(await setSuspension(fakeDb(), "r1", null, "a@x.dev", "2026-11-25T10:05:00.654Z")).toEqual({ ok: true });
  expect(row).toMatchObject({ suspended_at: null, suspended_reason: null, suspended_by: null });
});

it("has the reload message in both languages", async () => {
  const { messagesFor } = await import("@/lib/i18n");
  for (const locale of ["es", "en"] as const) {
    const text = (messagesFor(locale) as unknown as { apiErr: Record<string, string> }).apiErr.suspensionChangedMeanwhile;
    expect(text).toMatch(locale === "es" ? /Vuelve a cargar/ : /Reload/);
  }
});
