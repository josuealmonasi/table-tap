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
it("batch 5 cross-review 1: a refused first send lets the form go back to editing", async () => {
  // A sold-out dish or a closed kitchen on the first try: no other request
  // ever carried this reference, so the person fixes the cart and sends anew.
  state.fetch.mockResolvedValueOnce(Response.json({ error: "closed" }, { status: 409 }));
  const send = useCostsSend(true);
  await send("/api/costs/purchases", "POST", { packs: 1, total: 100 });
  expect(send.pending()).toBe(false);
});
it("batch 5 cross-review 1: a route's refusal of a retry keeps the reference while the first may still commit", async () => {
  // Request A stalls on its way to committing and its reply is lost; retry B
  // meets "orders paused" before A lands. Forgetting the reference there let
  // the next send record a second MX$100 purchase.
  const purchases = new Map<string, number>();
  let call = 0;
  state.fetch.mockImplementation(async (_path, init) => {
    const body = JSON.parse(init.body);
    call++;
    if (call === 1) throw new Error("reply lost; the request is still on its way");
    if (call === 2) { purchases.set(body.ref, 100); return Response.json({ error: "paused" }, { status: 409 }); }
    if (!purchases.has(body.ref)) purchases.set(body.ref, 100);
    return Response.json({ ok: true, id: body.ref });
  });
  const send = useCostsSend(true);
  for (let n = 0; n < 3; n++) await send("/api/costs/purchases", "POST", { packs: 1, total: 100 });
  expect(purchases.size).toBe(1);
});
