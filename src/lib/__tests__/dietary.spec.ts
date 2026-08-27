import { describe, it, expect } from "vitest";
import { dietaryTags, isBuiltIn, tagKey, tagLabel, tagsFor } from "@/lib/dietary";
import type { StoredDietaryTag } from "@/lib/dietary";

describe("dietaryTags", () => {
  it("resolves known keys to tags, preserving order", () => {
    const tags = dietaryTags(["vegan", "spicy"]);
    expect(tags.map(t => t.key)).toEqual(["vegan", "spicy"]);
    expect(tags[0].label).toBe("Vegan");
    expect(tags[0].emoji).toBeTruthy();
  });

  it("drops unknown keys", () => {
    expect(dietaryTags(["vegan", "made-up"]).map(t => t.key)).toEqual(["vegan"]);
  });

  it("handles null, undefined and empty input", () => {
    expect(dietaryTags(null)).toEqual([]);
    expect(dietaryTags(undefined)).toEqual([]);
    expect(dietaryTags([])).toEqual([]);
  });
});

const row = (over: Partial<StoredDietaryTag> = {}): StoredDietaryTag => ({
  id: "1",
  key: "sin_azucar",
  label: "Sin azúcar",
  label_en: "Sugar-free",
  emoji: "🍬",
  sort_order: 0,
  ...over,
});

describe("tagsFor", () => {
  it("falls back to the built-ins while the restaurant's own have not loaded", () => {
    expect(tagsFor(null).map(t => t.key)).toContain("vegan");
    expect(tagsFor([]).map(t => t.key)).toContain("vegan");
  });

  it("uses the restaurant's list once it has one, in its own order", () => {
    const tags = tagsFor([row({ id: "b", key: "b", sort_order: 1 }), row({ id: "a", key: "a", sort_order: 0 })]);
    expect(tags.map(t => t.key)).toEqual(["a", "b"]);
  });

  it("lets a restaurant drop a built-in entirely", () => {
    // A seafood restaurant does not need "contains seafood" across the whole menu.
    const kept = tagsFor([row({ key: "vegan", label: "Vegano", label_en: null })]);
    expect(kept.map(t => t.key)).toEqual(["vegan"]);
    expect(kept.map(t => t.key)).not.toContain("seafood");
  });
});

describe("tagLabel", () => {
  const t = (key: string) => (key === "dietary.vegan" ? "Vegano" : key);

  it("translates the built-ins by key, ignoring any stored label", () => {
    expect(tagLabel({ key: "vegan", label: "whatever", emoji: "🌱" }, t)).toBe("Vegano");
  });

  it("uses the restaurant's own words for its own tags", () => {
    expect(tagLabel({ key: "sin_azucar", label: "Sin azúcar", labelEn: "Sugar-free", emoji: "🍬" }, t)).toBe("Sin azúcar");
    expect(tagLabel({ key: "sin_azucar", label: "Sin azúcar", labelEn: "Sugar-free", emoji: "🍬" }, t, "en")).toBe("Sugar-free");
  });

  it("falls back to the written label when no English was given", () => {
    expect(tagLabel({ key: "x", label: "Receta de la casa", labelEn: null, emoji: "👩‍🍳" }, t, "en")).toBe("Receta de la casa");
  });
});

describe("tagKey", () => {
  it("strips accents, case and punctuation", () => {
    expect(tagKey("Sin azúcar")).toBe("sin_azucar");
    expect(tagKey("Contiene MANÍ")).toBe("contiene_mani");
  });

  it("returns nothing usable when there are no letters to work with", () => {
    // Only an emoji leaves nowhere to store it on the dish.
    expect(tagKey("🌶️")).toBe("");
    expect(tagKey("   ")).toBe("");
  });

  it("keeps the built-in keys stable, so old dishes stay attached", () => {
    expect(tagKey("gluten free")).toBe("gluten_free");
    expect(isBuiltIn("gluten_free")).toBe(true);
    expect(isBuiltIn("sin_azucar")).toBe(false);
  });
});

describe("dietaryTags against a restaurant's own list", () => {
  it("resolves keys the restaurant defined", () => {
    const all = tagsFor([row()]);
    expect(dietaryTags(["sin_azucar"], all).map(t => t.label)).toEqual(["Sin azúcar"]);
  });

  it("drops a key whose tag the restaurant deleted", () => {
    // This is what protects the menu while the deletion detaches the key from the dish.
    expect(dietaryTags(["vegan"], tagsFor([row()]))).toEqual([]);
  });
});
