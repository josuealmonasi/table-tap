import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePhoto, preparePhoto } from "@/lib/image-resize";
import type { ImageSpec } from "@/lib/images";

/**
 * Owners upload straight from a phone, and whatever is stored is what every
 * diner downloads over restaurant wifi. This runs in plain Node, so the three
 * browser APIs it touches are stood up by hand and the drawing is recorded
 * rather than rendered — which is enough, because the part worth checking is
 * the arithmetic and the decisions, not the pixels.
 */
type Encoder = "webp" | "safari" | "none";
function stubBrowser(photo: { width: number; height: number } | null, opts: { encoder?: Encoder; ctx?: boolean } = {}) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (opts.ctx === false ? null : { drawImage }),
    toBlob: (cb: (b: Blob | null) => void, type?: string) => cb(encode(opts.encoder ?? "webp", type)),
  };
  vi.stubGlobal("createImageBitmap", async () => {
    if (!photo) throw new Error("cannot decode");
    return { ...photo, close };
  });
  vi.stubGlobal("document", { createElement: () => canvas });
  return { close, drawImage, canvas };
}
/** What a browser hands back when asked for `type`. Safari has no WebP encoder and answers PNG. */
function encode(encoder: Encoder, type?: string): Blob | null {
  if (encoder === "none") return null;
  if (encoder === "safari" && type === "image/webp") return new Blob(["png"], { type: "image/png" });
  return new Blob(["x"], { type });
}
afterEach(() => vi.unstubAllGlobals());

const file = new File(["jpeg"], "dish.jpg", { type: "image/jpeg" });
const spec = (width: number, height: number) => ({ width, height, minWidth: 1, maxBytes: 5 * 1024 * 1024 }) as ImageSpec;

describe("a photo is cropped to fill, never letterboxed", () => {
  for (const [label, photo] of [
    ["a tall phone photo", { width: 3024, height: 4032 }],
    ["a wide one", { width: 4032, height: 1500 }],
    ["one already the right shape", { width: 1600, height: 900 }],
    ["one smaller than the band", { width: 400, height: 300 }],
  ] as const) {
    it(`covers the whole canvas and keeps its shape — ${label}`, async () => {
      const { drawImage, canvas } = stubBrowser(photo);
      await preparePhoto(file, spec(1600, 900));
      expect([canvas.width, canvas.height]).toEqual([1600, 900]);

      const [, x, y, w, h] = drawImage.mock.calls[0];
      expect(w).toBeGreaterThanOrEqual(1600 - 1e-9);
      expect(h).toBeGreaterThanOrEqual(900 - 1e-9);
      expect(w / h).toBeCloseTo(photo.width / photo.height, 9);
      expect(x + w / 2).toBeCloseTo(800, 9);
      expect(y + h / 2).toBeCloseTo(450, 9);
    });
  }
});

describe("what is stored, and what storage is told", () => {
  it("stores WebP where the browser can make it", async () => {
    stubBrowser({ width: 1000, height: 1000 });
    expect(await preparePhoto(file, spec(500, 500))).toMatchObject({ contentType: "image/webp", ext: "webp", sourceWidth: 1000 });
  });

  it("stores a JPEG from Safari, which hands back PNG when asked for WebP", async () => {
    stubBrowser({ width: 1000, height: 1000 }, { encoder: "safari" });
    const out = await preparePhoto(file, spec(500, 500));
    expect(out).toMatchObject({ contentType: "image/jpeg", ext: "jpg" });
    expect("blob" in out && out.blob.type).toBe("image/jpeg");
  });

  it("never labels one thing as another", async () => {
    stubBrowser({ width: 1000, height: 1000 }, { encoder: "safari" });
    const out = await encodePhoto(document.createElement("canvas") as never);
    expect(out?.blob.type).toBe(out?.contentType);
  });
});

describe("when a photo can't be used, it says why", () => {
  it("a file the browser can't decode is not a photo it can take", async () => {
    stubBrowser(null);
    expect(await preparePhoto(new File(["?"], "IMG.HEIC", { type: "image/heic" }), spec(500, 500))).toEqual({ error: "img.badType" });
  });

  it("a browser that can encode nothing fails plainly", async () => {
    stubBrowser({ width: 1000, height: 1000 }, { encoder: "none" });
    expect(await preparePhoto(file, spec(500, 500))).toEqual({ error: "img.failed" });
  });

  it("no canvas to draw on fails plainly", async () => {
    stubBrowser({ width: 1000, height: 1000 }, { ctx: false });
    expect(await preparePhoto(file, spec(500, 500))).toEqual({ error: "img.failed" });
  });
});

describe("the decoded photo is always let go", () => {
  // A phone photo decoded is tens of megabytes of memory. `close()` sits in a
  // `finally` so it runs on every way out, including the early returns.
  it("after a resize", async () => {
    const { close } = stubBrowser({ width: 1000, height: 1000 });
    await preparePhoto(file, spec(500, 500));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("after giving up for want of a canvas", async () => {
    const { close } = stubBrowser({ width: 1000, height: 1000 }, { ctx: false });
    await preparePhoto(file, spec(500, 500));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
