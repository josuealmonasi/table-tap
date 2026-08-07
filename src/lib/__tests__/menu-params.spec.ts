import { describe, expect, it } from "vitest";
import { applyMenuParams, readMenuParams, toQueryString } from "../menu-params";

const read = (qs: string) => readMenuParams(new URLSearchParams(qs));
const apply = (qs: string, patch: Parameters<typeof applyMenuParams>[1]) =>
  applyMenuParams(new URLSearchParams(qs), patch).toString();

describe("readMenuParams", () => {
  it("defaults an empty query to a clean view", () => {
    expect(read("")).toEqual({ q: "", cat: "all", diet: [], item: null });
  });

  it("reads every key", () => {
    expect(read("q=ramen&cat=c1&diet=vegan,gluten_free&item=i9")).toEqual({
      q: "ramen",
      cat: "c1",
      diet: ["vegan", "gluten_free"],
      item: "i9",
    });
  });

  it("treats an empty cat as 'all' rather than a category named ''", () => {
    expect(read("cat=").cat).toBe("all");
  });

  it("drops blanks from a trailing or doubled comma", () => {
    expect(read("diet=vegan,,").diet).toEqual(["vegan"]);
  });

  it("dedupes a hand-edited link so one filter can't count twice", () => {
    expect(read("diet=vegan,vegan,halal").diet).toEqual(["vegan", "halal"]);
  });
});

describe("applyMenuParams", () => {
  it("drops keys at their default instead of writing empties", () => {
    expect(apply("", { q: "", cat: "all", diet: [], item: null })).toBe("");
  });

  it("writes only what changed and leaves the rest alone", () => {
    expect(apply("q=ramen", { cat: "c1" })).toBe("q=ramen&cat=c1");
  });

  it("clears a key when it returns to its default", () => {
    expect(apply("q=ramen&cat=c1", { cat: "all" })).toBe("q=ramen");
  });

  it("preserves params that aren't ours", () => {
    // A campaign tag on a shared link must survive a filter change.
    expect(apply("utm_source=qr", { diet: ["vegan"] })).toBe("utm_source=qr&diet=vegan");
  });

  it("trims whitespace-only searches to nothing", () => {
    expect(apply("", { q: "   " })).toBe("");
  });

  it("round-trips through read", () => {
    const qs = apply("", { q: "taco", cat: "c2", diet: ["vegan", "halal"], item: "i1" });
    expect(read(qs)).toEqual({
      q: "taco",
      cat: "c2",
      diet: ["vegan", "halal"],
      item: "i1",
    });
  });
});

describe("toQueryString", () => {
  it("is empty when nothing is set, so a clean view has a clean URL", () => {
    expect(toQueryString(new URLSearchParams(""))).toBe("");
  });

  it("prefixes with ? when there is something to carry", () => {
    expect(toQueryString(new URLSearchParams("q=a"))).toBe("?q=a");
  });
});
