import { createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export const MEMBER_COOKIE = "tt-table-member";
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The browser never chooses its credential or receives the stored hash. */
export function memberToken(req: NextRequest): string | null {
  const token = req.cookies.get(MEMBER_COOKIE)?.value;
  return token && TOKEN.test(token) ? token : null;
}

export function memberHash(req: NextRequest): string | null {
  const token = memberToken(req);
  return token ? hashMemberToken(token) : null;
}

export function hashMemberToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newMemberToken(): string {
  return randomBytes(32).toString("base64url");
}

export function keepMemberToken(response: NextResponse, token: string): NextResponse {
  response.cookies.set(MEMBER_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/", maxAge: 365 * 24 * 60 * 60,
  });
  return response;
}
