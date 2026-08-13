/**
 * Where menu photography lives and what shape it should be.
 *
 * Paths start with the restaurant id because that is what the storage policy
 * reads to decide who may write: `has_role(storage_restaurant(name), ...)`.
 * Build paths only through here — a path that doesn't start with the id is
 * refused by the database, which is the behaviour we want but a confusing way
 * to find out.
 */

export const BUCKET = "menu";

/** The cover shown above the menu header. One per restaurant, so it overwrites. */
export function coverPath(restaurantId: string, ext = "webp"): string {
  return `${restaurantId}/cover.${ext}`;
}

/** A dish photo. Keyed by item so re-uploading replaces rather than accumulates. */
export function itemPath(restaurantId: string, itemId: string, ext = "webp"): string {
  return `${restaurantId}/items/${itemId}.${ext}`;
}

/**
 * What we ask owners for, and what we resize to before upload.
 *
 * The cover is wide because it sits in a short full-width band above the
 * header — a square photo would be cropped to a letterbox anyway, so it is
 * kinder to say so up front. Dish photos are square because the thumbnail is.
 *
 * `min` is the point below which a photo will look soft on a 3x phone screen;
 * we warn rather than refuse, since a slightly small photo still beats none.
 */
export interface ImageSpec {
  width: number;
  height: number;
  minWidth: number;
  maxBytes: number;
}

export const COVER: ImageSpec = {
  width: 1600,
  height: 600,
  minWidth: 800,
  maxBytes: 5 * 1024 * 1024,
};

export const DISH: ImageSpec = {
  width: 800,
  height: 800,
  minWidth: 400,
  maxBytes: 5 * 1024 * 1024,
};

export const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/** Why this file can't be used, or null when it's fine. Keys, not sentences. */
export function fileError(file: { type: string; size: number }, spec: ImageSpec): string | null {
  if (!ACCEPTED.includes(file.type)) return "img.badType";
  if (file.size > spec.maxBytes) return "img.tooBig";
  return null;
}

/** Aspect ratio as a CSS-ready string, so the band reserves space before load. */
export function ratio(spec: ImageSpec): string {
  return `${spec.width} / ${spec.height}`;
}
