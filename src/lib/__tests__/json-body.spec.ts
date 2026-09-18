import { describe, expect, it } from "vitest";
import { jsonBody } from "@/lib/json-body";

/** A stand-in for the Request the routes are handed. */
const body = (raw: string): Request =>
  new Request("https://x.dev/api/thing", { method: "POST", body: raw });

describe("reading a request body", () => {
  it("hands back an object", async () => {
    expect(await jsonBody(body('{"a":1}'))).toEqual({ a: 1 });
  });

  it("refuses what is not JSON at all", async () => {
    // A truncated upload, or a proxy that mangled it.
    expect(await jsonBody(body("{oops"))).toBeNull();
    expect(await jsonBody(body(""))).toBeNull();
  });

  it("refuses the body `null`, which parses perfectly and then throws", async () => {
    // This is the one `.catch(() => ({}))` never caught: JSON.parse is happy,
    // and the destructure on the next line is what falls over.
    expect(await jsonBody(body("null"))).toBeNull();
  });

  it("refuses a list and a bare string", async () => {
    // `typeof [] === "object"`, so an array walks straight past a naive check
    // and then has none of the fields the route is about to read.
    expect(await jsonBody(body("[1,2,3]"))).toBeNull();
    expect(await jsonBody(body('"hello"'))).toBeNull();
    expect(await jsonBody(body("42"))).toBeNull();
  });
});
