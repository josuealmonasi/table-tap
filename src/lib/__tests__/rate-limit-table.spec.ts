import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

// The limiter's counter, kept in memory: one count per bucket, as
// `rate_limit_hit` keeps one row per bucket within a window.
const hits = new Map<string, number>();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (_fn: string, args: { p_bucket: string }) => {
      const n = (hits.get(args.p_bucket) ?? 0) + 1;
      hits.set(args.p_bucket, n);
      return { data: n, error: null };
    },
  }),
}));

const { TABLES_PER_ADDRESS, isRoomLimited, isTableLimited } = await import("@/lib/rate-limit");

const from = (address: string): NextRequest =>
  ({ headers: new Headers({ "x-forwarded-for": address }) }) as unknown as NextRequest;

/** One diner write, counted the way the routes count it: the room, then the table. */
async function write(address: string, table: string | null, perTable = 10): Promise<boolean> {
  const req = from(address);
  return (await isRoomLimited(req, "billpay", perTable)) || (await isTableLimited(req, "billpay", table, perTable));
}

const TABLE = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("a diner's write, counted per table with a ceiling for the room", () => {
  beforeEach(() => hits.clear());

  it("lets every table in a full room do what one phone could, behind one address", async () => {
    const refused: string[] = [];
    for (let t = 0; t < TABLES_PER_ADDRESS; t++) {
      for (let i = 0; i < 10; i++) if (await write("189.203.14.7", TABLE(t))) refused.push(`table ${t}, write ${i + 1}`);
    }
    expect(refused).toEqual([]);
  });

  it("still stops one client hammering one table", async () => {
    for (let i = 0; i < 10; i++) expect(await write("189.203.14.7", TABLE(1))).toBe(false);
    expect(await write("189.203.14.7", TABLE(1))).toBe(true);
    // Another table behind the same address is untouched by it.
    expect(await write("189.203.14.7", TABLE(2))).toBe(false);
  });

  it("stops a client inventing tables at the room's ceiling", async () => {
    const ceiling = 10 * TABLES_PER_ADDRESS;
    for (let i = 0; i < ceiling; i++) expect(await write("189.203.14.7", TABLE(1000 + i))).toBe(false);
    expect(await write("189.203.14.7", TABLE(5000))).toBe(true);
    // ...and opens no counter for a table once the room has said no.
    const tableRows = [...hits.keys()].length;
    await write("189.203.14.7", TABLE(5001));
    expect([...hits.keys()].length).toBe(tableRows);
  });

  it("keeps each address's allowance its own", async () => {
    for (let i = 0; i < 10; i++) await write("189.203.14.7", TABLE(1));
    expect(await write("189.203.14.8", TABLE(1))).toBe(false);
  });

  it("treats the counter as one place, as the whole address was before", async () => {
    for (let i = 0; i < 10; i++) expect(await write("189.203.14.7", null)).toBe(false);
    expect(await write("189.203.14.7", null)).toBe(true);
  });

  it("writes no address and no table into the rows it opens", async () => {
    await write("189.203.14.7", TABLE(7));
    const buckets = [...hits.keys()];
    expect(buckets).toHaveLength(2);
    for (const b of buckets) {
      expect(b).toMatch(/^billpay:[0-9a-f]{20}$/);
      for (const part of ["189", "203", "14.7", TABLE(7), TABLE(7).slice(-12)]) expect(b).not.toContain(part);
    }
  });
});
