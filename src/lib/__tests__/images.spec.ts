import { describe, expect, it } from "vitest";
import {
  COVER,
  DISH,
  coverPath,
  fileError,
  itemPath,
  ratio,
} from "@/lib/images";

const RESTAURANT = "ef812e8a-2151-466d-b3bb-9fa080139934";
const ITEM = "c380d39d-cb94-41b1-830d-08e70a82203d";

describe("storage paths", () => {
  it("starts every path with the restaurant id, which is what the policy reads", () => {
    // storage_restaurant() takes the first segment; anything else denies the
    // write, so this is the security-relevant part of the shape.
    expect(coverPath(RESTAURANT).split("/")[0]).toBe(RESTAURANT);
    expect(itemPath(RESTAURANT, ITEM).split("/")[0]).toBe(RESTAURANT);
  });

  it("keeps one cover per restaurant and one photo per dish, so re-uploads replace", () => {
    expect(coverPath(RESTAURANT)).toBe(coverPath(RESTAURANT));
    expect(itemPath(RESTAURANT, ITEM)).toBe(itemPath(RESTAURANT, ITEM));
    expect(itemPath(RESTAURANT, "other")).not.toBe(itemPath(RESTAURANT, ITEM));
  });

  it("defaults to webp but keeps the extension it is given", () => {
    expect(coverPath(RESTAURANT)).toMatch(/\.webp$/);
    expect(coverPath(RESTAURANT, "png")).toMatch(/\.png$/);
  });
});

describe("fileError", () => {
  it("accepts the formats a phone camera produces", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(fileError({ type, size: 1000 }, COVER)).toBeNull();
    }
  });

  it("refuses anything that isn't one of those", () => {
    expect(fileError({ type: "application/pdf", size: 10 }, COVER)).toBe("img.badType");
    expect(fileError({ type: "image/svg+xml", size: 10 }, COVER)).toBe("img.badType");
  });

  it("refuses a file over the size limit", () => {
    expect(fileError({ type: "image/jpeg", size: COVER.maxBytes + 1 }, COVER)).toBe(
      "img.tooBig",
    );
    expect(fileError({ type: "image/jpeg", size: COVER.maxBytes }, COVER)).toBeNull();
  });
});

describe("specs", () => {
  it("asks for a wide cover and a square dish, matching where each is shown", () => {
    expect(COVER.width).toBeGreaterThan(COVER.height);
    expect(DISH.width).toBe(DISH.height);
  });

  it("gives a CSS ratio so the band can reserve its space before the photo loads", () => {
    expect(ratio(COVER)).toBe("1600 / 600");
    expect(ratio(DISH)).toBe("800 / 800");
  });
});
