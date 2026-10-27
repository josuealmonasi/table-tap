import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncReturnedFee } from "../fee";
import { chargeFixture } from "./charge-contract-fixtures";
const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
beforeEach(() => vi.clearAllMocks());

describe.each(["mxn", "usd"])("charge fee contract in %s", currency => {
  function setup() { const f = chargeFixture(currency); state.db = f.db; return f; }
  const run = (f: ReturnType<typeof setup>) => syncReturnedFee(f.client, "r", "pi", "acct").catch(() => {});
  it("same-revision race returns the fee once", async () => {
    const f = setup(); await Promise.all([run(f), run(f)]);
    expect(f.createRefund).toHaveBeenCalledTimes(1); expect(f.returned).toBe(180);
    expect(f.rpc).toHaveBeenCalledWith("claim_fee_return", expect.objectContaining({ p_revision: 1 }));
  });
  it("a reclaim under 23 hours reuses the same row and key", async () => {
    const f = setup(); const row = f.seed("dispatched"); f.age(2); await run(f);
    expect(f.createRefund).toHaveBeenCalledWith("fee", { amount: 180, metadata: { fee_return: row.id } }, { idempotencyKey: row.idempotency_key });
    expect(f.requests).toHaveLength(1); expect(row.status).toBe("succeeded");
  });
  it("absence never authorises a replacement after the window", async () => {
    const f = setup(); const row = f.seed("dispatched"); f.age(24); await run(f); await run(f);
    expect(row.status).toBe("unresolved"); expect(f.createRefund).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(1); expect(f.generation).toBe(0); expect(f.calls).toContain("fee-end");
  });
  it("positive metadata evidence resolves an unresolved row after exhaustive pagination", async () => {
    const f = setup(); const row = f.seed("unresolved");
    for (let i = 0; i < 101; i++) f.evidence.push({ id: `fr_other_${i}`, amount: 1, currency, metadata: {} });
    f.evidence.push({ id: "fr_match", amount: 180, currency, metadata: { fee_return: row.id } },
      { id: "fr_later", amount: 1, currency, metadata: {} }); f.returned = 180;
    await run(f);
    expect(row.status).toBe("succeeded"); expect(f.createRefund).not.toHaveBeenCalled();
    expect(f.calls.indexOf("fee-end")).toBeLessThan(f.calls.indexOf("record_fee_return"));
  });
  it("zero remainder after superseding gives none", async () => {
    const f = setup(); const row = f.seed("prepared"); f.returned = 180; await run(f);
    expect(row.status).toBe("superseded"); expect(f.requests).toHaveLength(1);
    expect(f.createRefund).not.toHaveBeenCalled(); expect(f.generation).toBeNull();
  });
  it("a newer enqueue survives the ack of the generation read at start", async () => {
    const f = setup(); f.returned = 180;
    const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => {
      if (name === "ack_fee_reconcile") await original("enqueue_fee_reconcile", { p_restaurant: "r", p_intent: "pi" });
      return original(name, args);
    });
    await run(f);
    expect(f.rpc).toHaveBeenCalledWith("ack_fee_reconcile", { p_restaurant: "r", p_intent: "pi", p_generation: 0 });
    expect(f.generation).toBe(1);
  });
});

it.each(["mxn", "usd"])("%s keeps a shorter prepared row superseded before dispatching its replacement", async currency => {
  const f = chargeFixture(currency); state.db = f.db;
  const old = f.seed("prepared", 300);
  await syncReturnedFee(f.client, "r", "pi", "acct");
  expect(old.status).toBe("superseded"); expect(f.requests).toHaveLength(2);
  expect(f.createRefund).toHaveBeenCalledWith("fee", { amount: 180, metadata: { fee_return: "request-2" } }, { idempotencyKey: "fee-key-2" });
});
it("a failed record keeps the same request outstanding for positive recovery", async () => {
  const f = chargeFixture("mxn"); state.db = f.db; const original = f.rpc.getMockImplementation()!;
  f.rpc.mockImplementation(async (name, args) => name === "record_fee_return" ? { data: null, error: { message: "offline" } } as never : original(name, args));
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("offline");
  expect(f.generation).toBe(0); expect(f.requests[0].status).toBe("dispatched");
  f.rpc.mockImplementation(original); await syncReturnedFee(f.client, "r", "pi", "acct");
  expect(f.createRefund).toHaveBeenCalledTimes(1); expect(f.generation).toBeNull();
});
it("a dispatched row inside the reclaim deadline waits with its original key", async () => {
  const f = chargeFixture("usd"); state.db = f.db; f.seed("dispatched");
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("pending");
  expect(f.createRefund).not.toHaveBeenCalled(); expect(f.requests).toHaveLength(1);
});
it.each(["stripe_account_id", "currency", "stripe_fee_id"])("a mismatched %s never reaches the provider", async field => {
  const f = chargeFixture("mxn"); state.db = f.db;
  Object.assign(f.seed("dispatched"), { [field]: "other" }); f.age(2);
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("pending");
  expect(f.createRefund).not.toHaveBeenCalled(); expect(f.generation).toBe(0);
});

it("finding metadata on an early page cannot resolve a row if a later page fails", async () => {
  const f = chargeFixture("usd"); state.db = f.db; const row = f.seed("unresolved"); f.returned = 180;
  f.feePages.mockImplementationOnce(() => (async function* () {
    yield { id: "fr_match", amount: 180, currency: "usd", metadata: { fee_return: row.id } };
    throw Error("later page unavailable");
  })());
  await expect(syncReturnedFee(f.client, "r", "pi", "acct")).rejects.toThrow("later page unavailable");
  expect(f.rpc.mock.calls.some(([name]) => name === "record_fee_return")).toBe(false);
  expect(row.status).toBe("unresolved"); expect(f.generation).toBe(0);
});
