import { afterEach, expect, it, vi } from "vitest";
import { contextCoveredSale, issueOfflineContext, readOfflineContext } from "@/lib/offline-authority";
import { sameOfflinePrice } from "@/lib/offline-pricing";

const now = Date.parse("2026-10-20T12:00:00Z");
afterEach(() => vi.unstubAllEnvs());
it("binds the original collector and currency to the restaurant without trusting browser fields", () => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  const proof = issueOfflineContext("restaurant", "cashier@example.com", "MXN", now);
  const context = readOfflineContext(proof, "restaurant")!;
  expect(context).toMatchObject({ collector: "cashier@example.com", currency: "MXN" });
  expect(readOfflineContext(proof, "other")).toBeNull();
  const [body, signature] = proof.split(".");
  const forged = Buffer.from(JSON.stringify({ ...context, collector: "other@example.com" })).toString("base64url");
  expect(readOfflineContext(`${forged}.${signature}`, "restaurant")).toBeNull();
  expect(readOfflineContext(`${body}.${signature}.extra`, "restaurant")).toBeNull();
  expect(contextCoveredSale(context, new Date(now + 11 * 60 * 60_000).toISOString())).toBe(true);
  expect(contextCoveredSale(context, new Date(now + 13 * 60 * 60_000).toISOString())).toBe(false);
  // Receipt age does not erase the identity proof needed for a late recovery.
  vi.setSystemTime(now + 40 * 86_400_000);
  expect(readOfflineContext(proof, "restaurant")).not.toBeNull();
  vi.useRealTimers();
});
it("requires approval for changed line prices even when the final amount still matches", () => {
  const price = { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 };
  const lines = [{ itemId: "dish", name: "Dish", emoji: "", qty: 1, price: 100, mods: {} }];
  const current = { price: { ...price, promoDetail: [] }, lines } as unknown as NonNullable<Awaited<ReturnType<typeof import("@/lib/offline-pricing").currentOfflinePrice>>>;
  expect(sameOfflinePrice({ ...price, at: "now" }, lines, current)).toBe(true);
  expect(sameOfflinePrice({ ...price, at: "now" }, [{ ...lines[0], price: 80 }], current)).toBe(false);
});
