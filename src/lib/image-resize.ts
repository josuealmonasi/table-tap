"use client";

import type { ImageSpec } from "@/lib/images";

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
 */
export async function resizeToSpec(file: File, spec: ImageSpec): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = spec.width;
    canvas.height = spec.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Cover-fit: scale so the shorter side fills, then centre the overflow.
    const scale = Math.max(spec.width / bitmap.width, spec.height / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (spec.width - w) / 2, (spec.height - h) / 2, w, h);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    // A browser without WebP encoding hands back null; the original still
    // works, it is just heavier.
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}

/** Pixel size of a chosen file, for warning when a photo is too small. */
export async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
