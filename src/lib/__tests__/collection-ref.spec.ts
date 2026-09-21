import { describe, expect, it, vi } from "vitest";
import { newRef } from "@/lib/collection-ref";

/**
 * The name of one collection, reused on every retry of it. The database
 * refuses a second payment carrying a reference it has already seen, so a
 * button tapped twice on a bad signal is one payment — and two DIFFERENT
 * collections must never be handed the same name, or the second is swallowed
 * and the money walks out.
 */
describe("naming a collection", () => {
  it("gives a different name every time", () => {
    const seen = new Set(Array.from({ length: 5_000 }, () => newRef()));
    expect(seen.size).toBe(5_000);
  });

  it("still does when the phone has no secure context", () => {
    // `crypto.randomUUID` needs https, which a phone on the restaurant's wifi
    // over plain http has not got. The fallback does not have to be a uuid —
    // it only has to be unlikely to collide with another collection in the
    // same restaurant.
    vi.stubGlobal("crypto", {});
    const seen = new Set(Array.from({ length: 5_000 }, () => newRef()));
    expect(seen.size).toBe(5_000);
    vi.unstubAllGlobals();
  });

  it("fits the column it is stored in", () => {
    vi.stubGlobal("crypto", {});
    expect(newRef().length).toBeLessThanOrEqual(100);
    vi.unstubAllGlobals();
    expect(newRef().length).toBeLessThanOrEqual(100);
  });
});
