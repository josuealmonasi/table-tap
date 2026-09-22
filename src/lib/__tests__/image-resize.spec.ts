import { afterEach, describe, expect, it, vi } from "vitest";
import { imageSize, resizeToSpec } from "@/lib/image-resize";
import type { ImageSpec } from "@/lib/images";

/**
 * Owners upload straight from a phone, and whatever is stored is what every
 * diner downloads over restaurant wifi. This runs in plain Node, so the three
 * browser APIs it touches are stood up by hand and the drawing is recorded
 * rather than rendered — which is enough, because the part worth checking is
 * the arithmetic, not the pixels.
 */
function stubBrowser(photo: { width: number; height: number }, opts: { webp?: boolean; ctx?: boolean } = {}) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (opts.ctx === false ? null : { drawImage }),
    toBlob: (cb: (b: Blob | null) => void) => cb(opts.webp === false ? null : new Blob(["webp"])),
  };
  vi.stubGlobal("createImageBitmap", async () => ({ ...photo, close }));
  vi.stubGlobal("document", { createElement: () => canvas });
  return { close, drawImage, canvas };
}
afterEach(() => vi.unstubAllGlobals());

const file = new File(["jpeg"], "dish.jpg", { type: "image/jpeg" });
const spec = (width: number, height: number) => ({ width, height }) as ImageSpec;

describe("a photo is cropped to fill, never letterboxed", () => {
  for (const [label, photo] of [
    ["a tall phone photo", { width: 3024, height: 4032 }],
    ["a wide one", { width: 4032, height: 1500 }],
    ["one already the right shape", { width: 1600, height: 900 }],
    ["one smaller than the band", { width: 400, height: 300 }],
  ] as const) {
    it(`covers the whole canvas and keeps its shape — ${label}`, async () => {
      const { drawImage, canvas } = stubBrowser(photo);
      await resizeToSpec(file, spec(1600, 900));
      expect([canvas.width, canvas.height]).toEqual([1600, 900]);

      const [, x, y, w, h] = drawImage.mock.calls[0];
      // Covers: nothing of the canvas is left unpainted.
      expect(w).toBeGreaterThanOrEqual(1600 - 1e-9);
      expect(h).toBeGreaterThanOrEqual(900 - 1e-9);
      // Keeps its shape: a dish is not stretched into an oval.
      expect(w / h).toBeCloseTo(photo.width / photo.height, 9);
      // Centred: the crop takes the middle, where the dish is.
      expect(x + w / 2).toBeCloseTo(800, 9);
      expect(y + h / 2).toBeCloseTo(450, 9);
    });
  }
});

describe("when the browser cannot do its part", () => {
  it("keeps the original if it cannot encode WebP", async () => {
    stubBrowser({ width: 1000, height: 1000 }, { webp: false });
    expect(await resizeToSpec(file, spec(500, 500))).toBe(file);
  });

  it("keeps the original if there is no canvas to draw on", async () => {
    stubBrowser({ width: 1000, height: 1000 }, { ctx: false });
    expect(await resizeToSpec(file, spec(500, 500))).toBe(file);
  });

  it("hands back the smaller WebP when it can", async () => {
    stubBrowser({ width: 1000, height: 1000 });
    const out = await resizeToSpec(file, spec(500, 500));
    expect(out).not.toBe(file);
  });
});

describe("the decoded photo is always let go", () => {
  // A phone photo decoded is tens of megabytes of memory. `close()` sits in a
  // `finally` so it runs on every way out, including the early returns.
  it("after a resize", async () => {
    const { close } = stubBrowser({ width: 1000, height: 1000 });
    await resizeToSpec(file, spec(500, 500));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("after giving up for want of a canvas", async () => {
    const { close } = stubBrowser({ width: 1000, height: 1000 }, { ctx: false });
    await resizeToSpec(file, spec(500, 500));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("after only measuring it", async () => {
    const { close } = stubBrowser({ width: 640, height: 480 });
    expect(await imageSize(file)).toEqual({ width: 640, height: 480 });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
