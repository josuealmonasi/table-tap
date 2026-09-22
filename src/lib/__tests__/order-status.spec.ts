import { describe, expect, it } from "vitest";
import { STATUS_META, statusMeta } from "@/lib/order-status";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { OrderStatus } from "@/lib/types";

/** Every status the database can hold. Kept here so the test fails if it grows. */
const ALL: OrderStatus[] = [
  "pending_payment", "received", "preparing", "ready", "completed", "cancelled",
];

const resolve = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    dict,
  );

describe("every stage of an order has a name", () => {
  it("names each status for itself, not by falling back", () => {
    // The map used to be keyed by string with a fallback to `completed`, so
    // `pending_payment` — a card checkout still waiting on Stripe — would have
    // been painted grey and called "Completado". It is keyed by OrderStatus
    // now, and this asserts every one has its OWN entry.
    for (const status of ALL) {
      expect(STATUS_META[status], status).toBeDefined();
      expect(statusMeta(status)).toBe(STATUS_META[status]);
    }
  });

  it("never calls a waiting payment finished", () => {
    expect(statusMeta("pending_payment").labelKey).not.toBe(statusMeta("completed").labelKey);
  });

  it("has words behind every label, in both languages", () => {
    const missing: string[] = [];
    for (const status of ALL) {
      const key = statusMeta(status).labelKey;
      if (typeof resolve(en, key) !== "string") missing.push(`en: ${key}`);
      if (typeof resolve(es, key) !== "string") missing.push(`es: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("paints from the design tokens, never a literal colour", () => {
    for (const status of ALL) expect(statusMeta(status).color).toMatch(/^var\(--tt-[a-z-]+\)$/);
  });

  it("shows something rather than nothing for a status this build has not heard of", () => {
    // A migration can run ahead of a deploy, so a row can arrive carrying a
    // status the running code does not know. Grey is better than blank.
    expect(statusMeta("teleported" as OrderStatus)).toBe(STATUS_META.completed);
  });
});
