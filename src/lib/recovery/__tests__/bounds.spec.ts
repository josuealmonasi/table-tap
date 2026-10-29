import { afterEach, expect, it, vi } from "vitest";
import { runBatch } from "../job";
import { fixture, old } from "./fixtures";

afterEach(() => vi.useRealTimers());

it("rotates past a full batch that stays pending instead of starving later restaurants", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(600_000);
  const f = fixture();
  const rows = Array.from({ length: 11 }, (_, i) => ({ restaurant_id: `r${i}`, created_at: old }));
  const recover = vi.fn(async () => false);
  const load = vi.fn(async (limit: number, offset = 0) => ({ data: rows.slice(offset, offset + limit), count: 11, error: null }));
  await runBatch("test", f.context, load, recover);
  expect(recover).toHaveBeenCalledWith(rows[10]);
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
