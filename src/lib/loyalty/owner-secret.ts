import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const cookieName = (code: string) => `tt-loyalty-owner-${code}`;
const emailCookieName = (code: string) => `tt-loyalty-email-owner-${code}`;

export function newOwnerSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOwnerSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function readOwnerSecret(req: NextRequest, code: string): string | null {
  const name = req.nextUrl.pathname === "/api/loyalty/card-email" ? emailCookieName(code) : cookieName(code);
  const secret = req.cookies.get(name)?.value;
  return secret && TOKEN.test(secret) ? secret : null;
}

export function matchesOwnerSecret(secret: string | null, hash: string | null): boolean {
  return Boolean(secret && hash && SHA256.test(hash)
    && timingSafeEqual(Buffer.from(hashOwnerSecret(secret), "hex"), Buffer.from(hash, "hex")));
}

export function keepOwnerSecret(response: NextResponse, code: string, secret: string | null): NextResponse {
  setSecretCookie(response, cookieName(code), "/api/rewards", secret);
  return keepEmailOwnerSecret(response, code, secret);
}

export function keepEmailOwnerSecret(response: NextResponse, code: string, secret: string | null): NextResponse {
  return setSecretCookie(response, emailCookieName(code), "/api/loyalty/card-email", secret);
}

function setSecretCookie(response: NextResponse, name: string, path: string, secret: string | null): NextResponse {
  response.cookies.set(name, secret ?? "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path,
    maxAge: secret ? 365 * 24 * 60 * 60 : 0,
  });
  return response;
}
