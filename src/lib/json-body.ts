/**
 * The body of a request, or nothing.
 *
 * `await req.json()` throws on anything that is not JSON, and returns a
 * perfectly good `null` for the body `null` — which then throws a second time
 * the moment somebody destructures it. Twenty-seven routes answered 500 to a
 * truncated upload, an empty POST or the four characters `null`, and several of
 * those are reachable without a login: calling a waiter, rating a dish,
 * checking a coupon, signing up. A 500 is the server saying it did not think of
 * this, and none of them had.
 *
 * `.catch(() => ({}))` was the older attempt and only covers half of it — the
 * parse error, not the body that parses into something with no properties.
 *
 * Returns the object, or null for a body that is missing, malformed, or simply
 * not an object. A route that gets null answers 400, which is what "you sent me
 * something I cannot read" has always meant.
 */
export async function jsonBody<T>(req: Request): Promise<T | null> {
  try {
    const parsed: unknown = await req.json();
    // Arrays are objects to `typeof`, and every caller here destructures named
    // fields, so a list is as unusable as a string.
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
