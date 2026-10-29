"use client";

import { useCallback, useRef } from "react";
import { newRef } from "@/lib/collection-ref";
import { normalizeEmail } from "@/lib/email";

/** A lost answer retries one send; a confirmed send allows another copy. */
export function useStatementMail(code: string): (email: string) => Promise<Response> {
  const pending = useRef<{ code: string; email: string; ref: string } | null>(null);
  return useCallback(async (email: string) => {
    const recipient = normalizeEmail(email);
    if (!pending.current || pending.current.code !== code || pending.current.email !== recipient) {
      pending.current = { code, email: recipient, ref: newRef() };
    }
    const attempt = pending.current;
    try {
      const response = await fetch("/api/account/email", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ c: code, email: attempt.email, ref: attempt.ref }),
      });
      if (response.ok && pending.current === attempt) pending.current = null;
      return response;
    } catch (cause) {
      // Keep the reference for a retry; the form reports the failed connection.
      throw new Error("Statement email request failed", { cause });
    }
  }, [code]);
}
