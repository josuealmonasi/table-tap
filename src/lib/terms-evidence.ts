import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import terms from "@/lib/legal/terms-es.json";

// Hash the complete source document in a stable encoding, not a rendered page.
export const TERMS_TEXT_HASH = createHash("sha256").update(JSON.stringify(terms)).digest("hex");

export function termsEvidence(req: NextRequest): { ip: string | null; userAgent: string | null } {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null,
    userAgent: req.headers.get("user-agent"),
  };
}
