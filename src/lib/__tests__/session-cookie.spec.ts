import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sessionCookie, sessionCookieHeader } from "../../../scripts/session-cookie.mjs";

const url = "https://project-ref.supabase.co";
const session = {
  access_token: "access", refresh_token: "refresh", expires_at: 1900000000,
  user: { id: "user-1", user_metadata: { name: "José 🥘" } },
};

it("keeps the existing SSR project name and UTF-8 session encoding", () => {
  const cookie = sessionCookie(session, url);
  expect(cookie.name).toBe("sb-project-ref-auth-token");
  expect(cookie.value).toBe(`base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`);
  expect(JSON.parse(Buffer.from(cookie.value.slice(7), "base64").toString("utf8"))).toEqual(session);
  expect(sessionCookieHeader(session, url)).toBe(`${cookie.name}=${cookie.value}`);
});

it("uses the supplied project without reading environment or changing the session", () => {
  const original = structuredClone(session);
  expect(sessionCookie(session, "http://localhost:54321").name).toBe("sb-localhost-auth-token");
  expect(sessionCookie(session, "https://other.supabase.co").name).toBe("sb-other-auth-token");
  expect(session).toEqual(original);
});

it.each([null, undefined])("refuses a missing session (%s) instead of signing in as nobody", missing => {
  expect(() => sessionCookie(missing, url)).toThrow("no session");
  expect(() => sessionCookieHeader(missing, url)).toThrow("no session");
});

it.each(["api-fixtures", "attack-money", "browser-fixtures", "promise-audit", "roles-check", "smoke"])(
  "%s uses the shared encoder instead of building a separate cookie", name => {
    const source = readFileSync(new URL(`../../../scripts/${name}.mjs`, import.meta.url), "utf8");
    expect(source).toContain('from "./session-cookie.mjs"');
    expect(source).not.toContain("auth-token");
    expect(source).not.toContain('toString("base64")');
  },
);
