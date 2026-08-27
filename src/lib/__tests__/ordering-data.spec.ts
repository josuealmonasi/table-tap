import { describe, expect, it } from "vitest";
import { unwrap } from "../ordering-data";
import { openMenuIds } from "@/lib/open-menus";

/**
 * These guard the distinction the customer menu depends on: "this restaurant
 * does not exist" (a real answer, safe to 404 on) versus "the query failed"
 * (must not be reported to a diner as a missing page or an empty menu).
 */
describe("unwrap", () => {
  it("returns data when the query succeeded", () => {
    expect(unwrap({ data: { id: "r1" }, error: null }, "restaurant")).toEqual({ id: "r1" });
  });

  it("passes an empty list through untouched", () => {
    expect(unwrap({ data: [], error: null }, "categories")).toEqual([]);
  });

  it("treats PGRST116 as a genuine miss, not a failure", () => {
    // .single() matching zero rows — the restaurant really isn't there, so the
    // caller is right to notFound() on the null.
    const res = { data: null, error: { code: "PGRST116", message: "no rows" } };
    expect(unwrap(res, "restaurant")).toBeNull();
  });

  it("treats an unparseable uuid as a miss, not a retryable fault", () => {
    // A mistyped QR link. Retrying it would fail identically forever, so the
    // diner must get "this code doesn't work", never a "try again" button.
    const res = {
      data: null,
      error: { code: "22P02", message: 'invalid input syntax for type uuid: "nope"' },
    };
    expect(unwrap(res, "restaurant")).toBeNull();
  });

  it("throws on a transient fault instead of returning null", () => {
    // The bug this fixes: a null here used to become a hard 404 for a customer
    // holding a valid QR code, roughly one scan in three during a blip.
    const res = { data: null, error: { code: "57P03", message: "cannot connect now" } };
    expect(() => unwrap(res, "restaurant")).toThrow(/cannot connect now/);
  });

  it("throws when an error carries no code at all", () => {
    const res = { data: null, error: { message: "socket hang up" } };
    expect(() => unwrap(res, "menu items")).toThrow(/menu items/);
  });

  it("names what failed, so the log says which query broke", () => {
    const res = { data: null, error: { code: "08006", message: "connection failure" } };
    expect(() => unwrap(res, "categories")).toThrow(/Could not load categories/);
  });
});

describe("a switched-off menu is a closed kitchen, not an empty restaurant", () => {
  const tz = "America/Mexico_City";

  it("says closed when every menu is switched off", () => {
    // The customer's own query cannot see these rows — the public policy is
    // `using (active = true)` — so this only works because the page reads them
    // with the service key. Read as a customer, the count came back zero and
    // `closedNow` said false, which served a blank page with no explanation.
    const { ids, closedNow } = openMenuIds(
      [
        { id: "a", active: false, schedule: null },
        { id: "b", active: false, schedule: null },
      ],
      tz,
    );
    expect(ids).toEqual([]);
    expect(closedNow).toBe(true);
  });

  it("still says nothing when the restaurant genuinely has no menus", () => {
    // A restaurant mid-setup has nothing to apologise for.
    expect(openMenuIds([], tz).closedNow).toBe(false);
  });

  it("says open when at least one menu is on", () => {
    const { ids, closedNow } = openMenuIds(
      [
        { id: "a", active: false, schedule: null },
        { id: "b", active: true, schedule: null },
      ],
      tz,
    );
    expect(ids).toEqual(["b"]);
    expect(closedNow).toBe(false);
  });
});
