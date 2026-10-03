import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PASS_SECONDS, PLACE_CEILING, issueVisitPass, offerAt, placeLimit, readVisitPass } from "@/lib/loyalty/pass";

const R = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TABLE = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";

describe("a visit pass", () => {
  let secret: string | undefined;
  beforeEach(() => {
    secret = process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SECRET_KEY = "test-secret";
  });
  afterEach(() => {
    process.env.SUPABASE_SECRET_KEY = secret;
  });

  it("is read back as the place it was issued for", () => {
    expect(readVisitPass(R, issueVisitPass(R, { table: TABLE }))?.place).toEqual({ table: TABLE });
    expect(readVisitPass(R, issueVisitPass(R, { order: ORDER }))?.place).toEqual({ order: ORDER });
    expect(readVisitPass(R, issueVisitPass(R, "counter"))?.place).toBe("counter");
  });

  it("is a new pass every time a page is rendered", () => {
    const a = readVisitPass(R, issueVisitPass(R, "counter"));
    const b = readVisitPass(R, issueVisitPass(R, "counter"));
    expect(a?.nonce).toBeTruthy();
    expect(a?.nonce).not.toBe(b?.nonce);
  });

  it("is refused for another restaurant", () => {
    expect(readVisitPass(OTHER, issueVisitPass(R, { table: TABLE }))).toBeNull();
  });

  it("is refused when any part of it is changed", () => {
    const pass = issueVisitPass(R, { table: TABLE });
    const [, issued, nonce, sig] = pass.split(".");
    // Moved to another table, or to the counter, the signature no longer fits.
    expect(readVisitPass(R, `t-${ORDER}.${issued}.${nonce}.${sig}`)).toBeNull();
    expect(readVisitPass(R, `menu.${issued}.${nonce}.${sig}`)).toBeNull();
    // A fresh nonce, to be spent again, is refused too.
    expect(readVisitPass(R, `t-${TABLE}.${issued}.AAAAAAAAAAAA.${sig}`)).toBeNull();
    expect(readVisitPass(R, `${pass.slice(0, -1)}${pass.endsWith("A") ? "B" : "A"}`)).toBeNull();
  });

  it("is refused once a sitting's length has gone by, and before it was issued", () => {
    const now = Date.now();
    const pass = issueVisitPass(R, "counter", now);
    expect(readVisitPass(R, pass, now + (PASS_SECONDS - 5) * 1000)).not.toBeNull();
    expect(readVisitPass(R, pass, now + (PASS_SECONDS + 5) * 1000)).toBeNull();
    expect(readVisitPass(R, pass, now - 5 * 60 * 1000)).toBeNull();
  });

  it("is refused when it is not one at all", () => {
    for (const junk of [undefined, null, 7, "", "menu", "a.b.c.d", "x".repeat(500), {}]) {
      expect(readVisitPass(R, junk)).toBeNull();
    }
  });

  it("cannot be made without the server's secret, and is never accepted unsigned", () => {
    const signed = issueVisitPass(R, "counter");
    delete process.env.SUPABASE_SECRET_KEY;
    expect(issueVisitPass(R, "counter")).toBe("");
    expect(readVisitPass(R, signed)).toBeNull();
  });

  it("narrows an offer to the page it is shown on", () => {
    const offer = { restaurantId: R, pass: issueVisitPass(R, "counter") };
    expect(readVisitPass(R, offerAt(offer, { table: TABLE })?.pass)?.place).toEqual({ table: TABLE });
    expect(offerAt(null, { table: TABLE })).toBeNull();
  });
});

describe("how many cards one place makes", () => {
  it("is one party's worth at a table or an order, for a whole sitting", () => {
    expect(placeLimit(R, { table: TABLE })).toEqual({
      bucket: `loyalty-card:${R}:t-${TABLE}`, limit: PLACE_CEILING.party, windowSeconds: PASS_SECONDS,
    });
    expect(placeLimit(R, { order: ORDER }).limit).toBe(PLACE_CEILING.party);
  });

  it("is counted by the hour at the counter, which is the whole room", () => {
    expect(placeLimit(R, "counter")).toEqual({
      bucket: `loyalty-card:${R}:menu`, limit: PLACE_CEILING.counterPerHour, windowSeconds: 3600,
    });
  });

  it("is kept apart for each restaurant and each table", () => {
    expect(placeLimit(R, { table: TABLE }).bucket).not.toBe(placeLimit(OTHER, { table: TABLE }).bucket);
    expect(placeLimit(R, { table: TABLE }).bucket).not.toBe(placeLimit(R, { order: TABLE }).bucket);
  });
});
