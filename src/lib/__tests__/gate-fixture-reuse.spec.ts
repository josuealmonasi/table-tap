import { beforeEach, describe, expect, it, vi } from "vitest";

const make = vi.hoisted(() => vi.fn(async (_admin: unknown, _restaurant: string, options = {}) => ({
  options, cleanup: vi.fn(async () => {}), body: () => ({}), startBody: {}, scope: {}, splitId: "split",
  slots: async () => [], receipts: async () => [],
})));
vi.mock("../../../scripts/split-slots-fixture.mjs", () => ({ splitSlotFixture: make }));
const { splitSlotCases } = await import("../../../scripts/api-cases/split-slots.mjs");
const { splitSlotFixtures } = await import("../../../scripts/split-slot-fixtures.mjs");
const { attackSplitSlots } = await import("../../../scripts/attack-split-slots.mjs");

describe("API split fixtures", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("borrows one sitting for refusals that leave the same split unchanged", async () => {
    const fx = { admin: {}, restaurant: { id: "restaurant" } };
    const cases = splitSlotCases(fx);
    for (const suffix of ["resize (stale)", "cancel (stale)", "resize (gone)", "collect (currency)"]) {
      const test = cases.find(c => c.name === `POST /api/split/${suffix}`)!;
      const restore = await test.arrange!(fx);
      await restore();
    }
    expect(make).toHaveBeenCalledTimes(1);
    expect((await make.mock.results[0].value).cleanup).not.toHaveBeenCalled();
    // The run, rather than an individual borrower, removes the shared rows.
    await (fx as typeof fx & { splitSlotFixtures: ReturnType<typeof splitSlotFixtures> }).splitSlotFixtures.cleanup();
    expect((await make.mock.results[0].value).cleanup).toHaveBeenCalledOnce();
  });
  it("keeps successful split changes on their own sittings", async () => {
    const fx = { admin: {}, restaurant: { id: "restaurant" } };
    const cases = splitSlotCases(fx);
    for (const suffix of ["resize", "cancel"]) {
      const test = cases.find(c => c.name === `POST /api/split/${suffix} (current revision)`)!;
      await (await test.arrange!(fx))();
    }
    expect(make).toHaveBeenCalledTimes(2);
    for (const result of make.mock.results) expect((await result.value).cleanup).toHaveBeenCalledOnce();
  });
  it("uses exactly two sittings for all eleven unchanged API split cases", async () => {
    const fx = { admin: {}, restaurant: { id: "restaurant" }, withCardReader: async () => async () => {} };
    const cases = splitSlotCases(fx);
    const names = ["start (stale)", "start (currency)", "start (busy)", "start (same request returns its split)",
      "resize (stale)", "resize (gone)", "cancel (stale)", "cancel (gone)",
      "collect (stale)", "collect (currency)", "pay (model 2 stale)"];
    for (const name of names) {
      const test = cases.find(c => c.name === `POST /api/split/${name}`)!;
      await (await test.arrange!(fx))();
    }
    expect(make).toHaveBeenCalledTimes(2);
    for (const result of make.mock.results) expect((await result.value).cleanup).not.toHaveBeenCalled();
    await (fx as typeof fx & { splitSlotFixtures: ReturnType<typeof splitSlotFixtures> }).splitSlotFixtures.cleanup();
    for (const result of make.mock.results) expect((await result.value).cleanup).toHaveBeenCalledOnce();
  });
  it("shares the two unchanged attack cases and cleans them at the end", async () => {
    const ok = vi.fn(), bad = vi.fn();
    await attackSplitSlots({ admin: {}, home: { id: "home" }, neighbour: { id: "foreign" },
      who: { waiter: "waiter", kitchen: "kitchen" }, ok, bad,
      post: async (_path: string, body: { revision?: number }, cookie: string) => ({
        status: cookie === "kitchen" || body.revision !== 2 ? 403 : 409, body: { code: "stale" },
      }),
    });
    // Writer operations are deliberately absent from this read-only fake.
    // Both unchanged operations must reach their existing gate assertions.
    expect(ok.mock.calls.map(([label]) => label)).toEqual([
      "split slots: a stale revision and another restaurant cannot collect or change parts",
      "split slots: the kitchen cannot start, change, cancel or collect the split",
    ]);
    expect(bad).toHaveBeenCalledTimes(4);
    expect(make).toHaveBeenCalledTimes(5);
    for (const result of make.mock.results) expect((await result.value).cleanup).toHaveBeenCalledOnce();
  });
  it("does not share incompatible state or share across runs", async () => {
    const first = splitSlotFixtures({}, "home"), second = splitSlotFixtures({}, "home");
    await first.acquire({}, true);
    await first.acquire({ start: true, currency: "MXN", shares: 2, totalCents: 11000 }, true);
    await first.acquire({ start: false }, true);
    await first.acquire({ currency: "USD" }, true);
    await first.acquire({}, false);
    await second.acquire({}, true);
    expect(make).toHaveBeenCalledTimes(5);
    await first.cleanup(); await second.cleanup();
    await first.cleanup();
    // Four shared sets, while the private writer still owns its own cleanup.
    const calls = await Promise.all(make.mock.results.map(async result => (await result.value).cleanup.mock.calls.length));
    expect(calls).toEqual([1, 1, 1, 0, 1]);
  });
  it("does not retain a failed setup", async () => {
    const fixtures = splitSlotFixtures({}, "home");
    make.mockRejectedValueOnce(new Error("insert failed"));
    await expect(fixtures.acquire({}, true)).rejects.toThrow("insert failed");
    await fixtures.acquire({}, true);
    expect(make).toHaveBeenCalledTimes(2);
    await fixtures.cleanup();
  });
});
