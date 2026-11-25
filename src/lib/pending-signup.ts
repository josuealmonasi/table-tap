import { createHash, randomBytes } from "node:crypto";
import type { Locale } from "@/lib/i18n";

interface SignupPayload {
  email: string;
  restaurantName: string;
  locale: Locale;
  termsVersion: string;
  termsTextHash: string;
}

export interface PendingSignup {
  id: string;
  payload: SignupPayload;
  expires_at: string;
}

export function newSignupToken(): string {
  return randomBytes(32).toString("hex");
}

export function signupHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
