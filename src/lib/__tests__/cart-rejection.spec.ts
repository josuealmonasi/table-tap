import { describe, expect, it } from "vitest";
import { rejectionMessage } from "@/lib/cart-rejection";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import type { CartRejection } from "@/lib/verify-cart";

/**
 * Every refusal a cart can meet, turned into words. `/api/table-order` once
 * answered `{ rejection }` with no message at all, and the waiter's screen
 * reads "no message" as "network error" — so a sold-out dish looked like a
 * dead connection and the waiter retried instead of telling the table.
 */
const resolve = (dict: unknown, key: string): unknown =>
  key.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    dict,
  );

const every: CartRejection[] = [
  { kind: "unavailable", name: "Tacos", itemId: "x" },
  { kind: "unavailable", name: "", itemId: "x" },
  { kind: "tooManyLines", limit: 200 },
  { kind: "tooManyRefs", limit: 500 },
  { kind: "missingModifiers", unanswered: ["Size", "Salsa"], forName: "Burrito", itemId: "x" },
  { kind: "removedExtras", ids: ["a", "b"], names: ["Cheese", "Bacon"] },
];

describe("a refusal always has words", () => {
  it("gives every kind a sentence that exists in both languages", () => {
    const missing: string[] = [];
    for (const r of every) {
      const { key } = rejectionMessage(r);
      if (typeof resolve(en, key) !== "string") missing.push(`en: ${key}`);
      if (typeof resolve(es, key) !== "string") missing.push(`es: ${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("fills in every blank its sentence has", () => {
    // A sentence with a {name} nobody supplied reaches the waiter as the
    // literal text "{name} is no longer available".
    for (const r of every) {
      const { key, vars } = rejectionMessage(r);
      const sentence = resolve(en, key) as string;
      const blanks = [...sentence.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
      for (const blank of blanks) expect(vars, `${r.kind}: {${blank}}`).toHaveProperty(blank);
    }
  });
});

describe("what it says", () => {
  it("names the dish when it knows it, and stands on its own when it does not", () => {
    expect(rejectionMessage({ kind: "unavailable", name: "Tacos", itemId: "x" }))
      .toEqual({ key: "apiErr.itemGone", vars: { name: "Tacos" } });
    expect(rejectionMessage({ kind: "unavailable", name: "", itemId: "x" }).key)
      .toBe("apiErr.itemGoneUnnamed");
  });

  it("tells the waiter the limit, so they know how far to split", () => {
    expect(rejectionMessage({ kind: "tooManyLines", limit: 98 }).vars).toEqual({ n: 98 });
  });

  it("lists every unanswered question and every vanished extra", () => {
    expect(rejectionMessage(every[4]).vars).toEqual({ options: "Size, Salsa", name: "Burrito" });
    expect(rejectionMessage(every[5]).vars).toEqual({ names: "Cheese, Bacon" });
  });

  it("tells two different refusals apart", () => {
    const keys = new Set(every.filter(r => r.kind !== "unavailable").map(r => rejectionMessage(r).key));
    expect(keys.size).toBe(4);
  });
});
