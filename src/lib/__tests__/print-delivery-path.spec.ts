import { afterEach, expect, it, vi } from "vitest";
import { printReprintRace } from "../../../scripts/api-print-delivery.mjs";

afterEach(() => vi.unstubAllGlobals());
it("resolves the cloudprnt route without arranging a delivery", async () => {
  const printToken = vi.fn(async () => "printer");
  const entry = printReprintRace();
  const path = await entry.path({ printToken });
  expect(path.split("?")[0]).toBe("/api/print/cloudprnt/printer");
  expect(printToken).toHaveBeenCalledExactlyOnceWith();
});
it("still confirms the old delivery and closes only the new copy after arrange", async () => {
  const reads = [
    { delivery_token: "old" },
    { delivery_token: "new", claimed_at: null, printed_at: null },
    { delivery_token: "new", claimed_at: "claimed", printed_at: null },
    { printed_at: "printed" },
  ];
  const query = {
    eq: () => query,
    single: async () => ({ data: reads.shift(), error: null }),
  };
  const fixture = { base: "http://fixture", printToken: async () => "printer",
    printJobId: "job", restaurant: { id: "r1" }, printableOrder: "order",
    who: { waiter: "cookie" }, admin: { from: () => ({ select: () => query }) } };
  const calls = vi.fn<typeof fetch>().mockImplementation(async (url, init) =>
    new Response(null, { status: init === undefined && String(url).endsWith("?token=old") ? 404 : 200 }));
  vi.stubGlobal("fetch", calls);
  const entry = printReprintRace();
  await entry.arrange(fixture);
  expect(await entry.path(fixture)).toBe("/api/print/cloudprnt/printer?token=old&code=OK");
  expect(await entry.effect(fixture)).toBe(true);
  expect(calls).toHaveBeenCalledWith("http://fixture/api/print/cloudprnt/printer?token=new&code=200%20OK",
    expect.objectContaining({ method: "DELETE" }));
  expect(reads).toEqual([]);
});
