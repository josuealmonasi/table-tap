"use client";

import { useRef } from "react";

export interface RetryIntent {
  body(value: object): string;
  clear(): void;
  pending(): boolean;
}

/** A lost reply must retry the exact request, even if the form changed. */
export function useRetryIntent(): RetryIntent {
  const saved = useRef<string | null>(null);
  return {
    body(value: object): string {
      saved.current ??= JSON.stringify({ ...value, ref: crypto.randomUUID() });
      return saved.current;
    },
    clear(): void { saved.current = null; },
    pending(): boolean { return saved.current !== null; },
  };
}

/**
 * Whether a refusal settles the attempt, so its reference may go. Only an
 * answer given after the server looked the reference up says the first try
 * did not commit. A rate limit (429), a timeout (408, 425) or a sign-in that
 * lapsed (401, 403) is answered before that. Cleared on a 429, a lost MX$100
 * pay-later order was created again under a new reference once the limit
 * passed. Keeping a reference is always safe; dropping it early is what
 * duplicates.
 */
export function refusalSettles(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status);
}
