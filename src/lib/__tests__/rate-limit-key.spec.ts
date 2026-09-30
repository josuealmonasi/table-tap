import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { clientKey } from "@/lib/rate-limit";

/**
 * A rate limit keys on who is asking, and keeps nothing that says who.
 *
 * It keyed on the caller's IP address itself, which put every diner's address
 * in `rate_limits` — kept for ever and named nowhere in the privacy notice.
 */
const from = (address: string): NextRequest =>
  ({ headers: new Headers({ "x-forwarded-for": `${address}, 10.0.0.1` }) }) as unknown as NextRequest;

describe("the rate limit's key", () => {
  it("is the same for the same address, so a limit still counts it", () => {
    expect(clientKey(from("189.203.14.7"))).toBe(clientKey(from("189.203.14.7")));
  });

  it("differs between addresses", () => {
    expect(clientKey(from("189.203.14.7"))).not.toBe(clientKey(from("189.203.14.8")));
  });

  it("does not contain the address, or any part of it", () => {
    const key = clientKey(from("189.203.14.7"));
    expect(key).toMatch(/^[0-9a-f]{20}$/);
    for (const part of ["189", "203", "14.7"]) expect(key).not.toContain(part);
  });

  it("is the only place a request's address is read", () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    const readers = walk("src")
      .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"))
      .filter(f => /x-forwarded-for|x-real-ip/.test(readFileSync(f, "utf8")));
    expect(readers).toEqual(["src/lib/rate-limit.ts"]);
  });

  it("is swept from the table after a day, as the privacy notice says", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const fn = schema.slice(schema.indexOf("function public.rate_limit_hit"), schema.indexOf("$$;", schema.indexOf("function public.rate_limit_hit")));
    expect(fn).toMatch(/delete from rate_limits where window_start < now\(\) - interval '1 day'/);
    const notice = readFileSync("src/lib/legal/privacy-es.json", "utf8");
    expect(notice).toMatch(/se elimina en un plazo máximo de un día/);
  });
});
