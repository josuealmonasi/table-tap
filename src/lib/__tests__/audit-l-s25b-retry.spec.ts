import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("react", () => ({ useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()], useCallback: (fn: unknown) => fn }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
const { useCostsSend } = await import("@/hooks/useCostsSend");
beforeEach(() => { state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch); });
it.each([400, 402, 404, 409, 410, 422])("L5 a pre-lookup %i cannot forget the lost MX$100 purchase", async status => {
  const purchases = new Map<string, number>();
  let call = 0;
  state.fetch.mockImplementation(async (_path, init) => {
    const body = JSON.parse(init.body);
    if (++call === 2) return Response.json({ error: "frozen or changed" }, { status });
    purchases.set(body.ref, 100);
    if (call === 1) throw new Error("reply lost after commit");
    return Response.json({ ok: true, id: body.ref });
  });
  const send = useCostsSend(true);
  for (let n = 0; n < 3; n++) await send("/api/costs/purchases", "POST", { packs: 1, total: 100 });
  expect(purchases.size).toBe(1);
  expect([...purchases.values()].reduce((a, b) => a + b, 0)).toBe(100);
});
it("L5 an explicit no-write result unlocks the request", async () => {
  state.fetch.mockResolvedValueOnce(Response.json({ error: "missing", retryUncommitted: true }, { status: 404 }));
  const send = useCostsSend(true);
  await send("/api/costs/purchases", "POST", { packs: 1, total: 100 });
  expect(send.pending()).toBe(false);
});
