"use client";

import { fileError, resultError, type ImageSpec } from "@/lib/images";

/** A photo resized and encoded for storage, with what to tell storage about it. */
export interface PreparedPhoto {
  blob: Blob;
  contentType: "image/webp" | "image/jpeg";
  ext: "webp" | "jpg";
  /** The original's width, for warning about a photo that will look soft. */
  sourceWidth: number;
}

/** Something that can encode a picture: a canvas, or a stand-in for one in tests. */
export interface Encodable {
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

/**
 * WebP when the browser can make it, JPEG when it can't.
 *
 * Safari cannot encode WebP. Asked for it, `toBlob` hands back a PNG — which
 * was then uploaded labelled as WebP, at several times the weight. A JPEG is
 * what every browser can make and every browser can show.
 */
export async function encodePhoto(canvas: Encodable): Promise<Pick<PreparedPhoto, "blob" | "contentType" | "ext"> | null> {
  const as = (type: string, quality: number) =>
    new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
  const webp = await as("image/webp", 0.82);
  if (webp?.type === "image/webp") return { blob: webp, contentType: "image/webp", ext: "webp" };
  const jpeg = await as("image/jpeg", 0.85);
  if (jpeg?.type === "image/jpeg") return { blob: jpeg, contentType: "image/jpeg", ext: "jpg" };
  return null;
}

/**
 * Shrinks a photo to the size we actually display, before it is uploaded.
 *
 * Owners upload straight from a phone, where a casual photo is several
 * megabytes and far larger than any screen it will appear on. Whatever we
 * store is what every diner downloads over restaurant wifi, so it is worth
 * paying for the resize once here rather than on every scan.
 *
 * Cover crops to fill: the band has a fixed shape, so a photo of another shape
 * would be letterboxed by the browser anyway — cropping to the middle is the
 * same result without the bars.
 *
 * Answers a message key instead when the photo can't be used: not a picture
 * this browser can open, or still too heavy after resizing.
 */
export async function preparePhoto(file: File, spec: ImageSpec): Promise<PreparedPhoto | { error: string }> {
  const bad = fileError(file);
  if (bad) return { error: bad };
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { error: "img.badType" };
  try {
    const canvas = document.createElement("canvas");
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "img.failed" };

    // Cover-fit: scale so the shorter side fills, then centre the overflow.
    const scale = Math.max(spec.width / bitmap.width, spec.height / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (spec.width - w) / 2, (spec.height - h) / 2, w, h);

    const encoded = await encodePhoto(canvas);
    if (!encoded) return { error: "img.failed" };
    const tooBig = resultError(encoded.blob, spec);
    if (tooBig) return { error: tooBig };
    return { ...encoded, sourceWidth: bitmap.width };
  } finally {
    bitmap.close();
  }
}
