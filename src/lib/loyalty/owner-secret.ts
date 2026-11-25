import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const cookieName = (code: string) => `tt-loyalty-owner-${code}`;

export function newOwnerSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOwnerSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function readOwnerSecret(req: NextRequest, code: string): string | null {
  const secret = req.cookies.get(cookieName(code))?.value;
  return secret && TOKEN.test(secret) ? secret : null;
}

export function matchesOwnerSecret(secret: string | null, hash: string | null): boolean {
  return Boolean(secret && hash && SHA256.test(hash)
    && timingSafeEqual(Buffer.from(hashOwnerSecret(secret), "hex"), Buffer.from(hash, "hex")));
}

export function keepOwnerSecret(response: NextResponse, code: string, secret: string | null): NextResponse {
  response.cookies.set(cookieName(code), secret ?? "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/rewards",
    maxAge: secret ? 365 * 24 * 60 * 60 : 0,
  });
  return response;
}
