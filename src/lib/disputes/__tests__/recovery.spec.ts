import { expect, it, vi } from "vitest";
import { fixture, notification } from "./fixtures";
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { ingestDispute } from "../ingest";
import { recoverDisputes } from "@/lib/recovery/disputes";

it("the existing bounded runner retries provider failures without another webhook", async () => {
  const f = fixture();
  f.client.disputes.retrieve.mockRejectedValueOnce(new Error("offline"));
  await ingestDispute(notification(), f.db, f.stripe);
  const q = { select: () => q, neq: () => q, order: () => q, range: () => q,
    returns: async () => { const rows = [...f.events.values()].filter(e => e.state !== "done"); return { data: rows, count: rows.length, error: null }; } };
  const original = f.from.getMockImplementation()!;
  f.from.mockImplementation(table => table === "stripe_dispute_events" ? q as never : original(table));
  expect(await recoverDisputes({ db: f.db, client: f.stripe, deadline: Date.now() + 10000 })).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(f.events.get("evt")?.state).toBe("done");
});
