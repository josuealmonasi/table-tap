import { beforeEach, describe, expect, it, vi } from "vitest";
import { NAME_TTL_MS, recallDinerName, rememberDinerName } from "@/lib/diner-name";

const R = "rest-1";
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("remembering the name so it is asked once", () => {
  it("gives it back for the next order", () => {
    rememberDinerName(R, "Ana María");
    expect(recallDinerName(R)).toBe("Ana María");
  });

  it("trims what it stores, since it gets read aloud", () => {
    rememberDinerName(R, "  Ana  ");
    expect(recallDinerName(R)).toBe("Ana");
  });

  it("does not remember a blank", () => {
    rememberDinerName(R, "   ");
    expect(recallDinerName(R)).toBe("");
  });

  it("keeps each restaurant's separate", () => {
    rememberDinerName(R, "Ana");
    expect(recallDinerName("otro")).toBe("");
  });

  it("forgets it after a visit's worth of time", () => {
    // A name from last week prefilled into somebody else's order is worse
    // than an empty field — shared phones and counter tablets exist.
    rememberDinerName(R, "Ana");
    expect(recallDinerName(R, Date.now() + NAME_TTL_MS + 1)).toBe("");
  });

  it("survives nothing being stored at all", () => {
    expect(recallDinerName(R)).toBe("");
  });

  it("reads corrupt storage as no name, never a throw", () => {
    store.set(`tt-name:${R}`, "{not json");
    expect(recallDinerName(R)).toBe("");
  });
});
