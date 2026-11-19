import { afterEach, expect, it, vi } from "vitest";
import { BATCH_SIZE, runBatch } from "../job";
import { fixture, old } from "./fixtures";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("rotates past a full batch that stays pending instead of starving later restaurants", async () => {
  vi.spyOn(Math, "random").mockReturnValue(0.75);
  const f = fixture();
  const rows = Array.from({ length: BATCH_SIZE + 1 }, (_, i) => ({ restaurant_id: `r${i}`, created_at: old }));
  const recover = vi.fn(async () => false);
  const load = vi.fn(async (limit: number, offset = 0) => ({ data: rows.slice(offset, offset + limit), count: BATCH_SIZE + 1, error: null }));
  await runBatch("test", f.context, load, recover);
  expect(recover).toHaveBeenCalledWith(rows[BATCH_SIZE]);
  expect(recover).toHaveBeenCalledTimes(1);
});

it("does not start another item when the observation reserve is reached", async () => {
  const f = fixture();
  f.context.deadline = Date.now() + 1000;
  const recover = vi.fn(async () => true);
  const row = { restaurant_id: "r", created_at: old };
  const load = vi.fn(async () => ({ data: [row], count: 1, error: null }));
  expect(await runBatch("test", f.context, load, recover)).toMatchObject({ done: 0, pending: 1 });
  expect(recover).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(2);
});

it("does not call a failed queue observation empty or discard earlier successes", async () => {
  const f = fixture();
  const load = vi.fn().mockResolvedValueOnce({ data: [{ restaurant_id: "r", created_at: old }], count: 1, error: null })
    .mockResolvedValueOnce({ data: null, count: null, error: { message: "database unavailable" } });
  expect(await runBatch("test", f.context, load, async () => true))
    .toMatchObject({ done: 1, pending: null, failed: 1, observation_failed: true });
});

it("reaches every page from a once-a-day schedule (E1)", async () => {
  // The clock rotation drew page 0 on every daily run: 144 ten-minute buckets apart.
  const rows = Array.from({ length: 2 * BATCH_SIZE }, (_, i) => ({ restaurant_id: `r${i}`, created_at: old }));
  const seen = new Set<string>();
  for (const draw of [0.1, 0.6]) {
    vi.spyOn(Math, "random").mockReturnValue(draw);
    const f = fixture();
    const recover = vi.fn(async (row: { restaurant_id: string }) => { seen.add(row.restaurant_id); return false; });
    const load = vi.fn(async (limit: number, offset = 0) => ({ data: rows.slice(offset, offset + limit), count: 2 * BATCH_SIZE, error: null }));
    await runBatch("test", f.context, load, recover);
    vi.restoreAllMocks();
  }
  expect(seen.has("r0") && seen.has(`r${BATCH_SIZE}`)).toBe(true);
});
