import { describe, expect, it } from "vitest";
import { everyRow, everyRowIn, IDS_PER_READ } from "@/lib/paged";

/** A table of `rows` served `cap` at a time, like PostgREST. */
function server(rows: number[], cap = 1000) {
  const calls: { from: number; to: number; ids?: string[] }[] = [];
  const page = (from: number, to: number, ids?: string[]) => {
    calls.push({ from, to, ids });
    const end = Math.min(to + 1, from + cap);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  return { calls, page };
}

describe("every row of a read", () => {
  it("pages past the server's cap until a page comes back empty", async () => {
    const s = server(Array.from({ length: 2500 }, (_, i) => i), 1000);
    const rows = await everyRow((a, b) => s.page(a, b), "the rows");
    expect(rows).toHaveLength(2500);
    expect(s.calls.map(c => c.from)).toEqual([0, 1000, 2000, 2500]);
  });

  it("throws on a failed page instead of returning part of the rows", async () => {
    await expect(everyRow(() => Promise.resolve({ data: null, error: { message: "boom" } }), "the rows"))
      .rejects.toThrow(/Could not read the rows: boom/);
  });
});

describe("every row of a read filtered to a long list of ids", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it("sends the ids in slices short enough for a URL, once each", async () => {
    const slices: string[][] = [];
    const rows = await everyRowIn(
      [...ids(400), "id-0", "id-1"],
      (slice, from) => {
        if (from === 0) slices.push(slice);
        return Promise.resolve({ data: from === 0 ? slice : [], error: null });
      },
      "the extras",
    );
    expect(slices.map(s => s.length)).toEqual([IDS_PER_READ, IDS_PER_READ, 400 - 2 * IDS_PER_READ]);
    expect(rows).toHaveLength(400);
    expect(new Set(rows).size).toBe(400);
  });

  it("reads each slice past the server's cap", async () => {
    // One slice of dishes with more links than one request returns.
    const links = Array.from({ length: 1500 }, (_, i) => i);
    const rows = await everyRowIn(ids(10), (_slice, from, to) => server(links).page(from, to), "the extras");
    expect(rows).toHaveLength(1500);
  });

  it("asks nothing for an empty list", async () => {
    let asked = 0;
    const rows = await everyRowIn([], () => { asked++; return Promise.resolve({ data: [], error: null }); }, "the extras");
    expect(rows).toEqual([]);
    expect(asked).toBe(0);
  });

  it("throws when any slice fails", async () => {
    await expect(everyRowIn(
      ids(200),
      (slice, from) => Promise.resolve(slice[0] === "id-150"
        ? { data: null, error: { message: "URI too long" } }
        : { data: from === 0 ? slice : [], error: null }),
      "the extras",
    )).rejects.toThrow(/Could not read the extras: URI too long/);
  });
});
