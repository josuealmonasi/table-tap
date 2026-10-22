"use client";

import { useRef, useState } from "react";

export interface RetryIntent {
  body(value: object): string;
  frozen<T extends object>(): T | null;
  clear(): void;
  pending(): boolean;
}

/** A lost reply must retry the exact request, even if the form changed. */
export function useRetryIntent(): RetryIntent {
  const saved = useRef<string | null>(null);
  const [, refresh] = useState(0);
  return {
    body(value: object): string {
      if (saved.current === null) {
        saved.current = JSON.stringify({ ...value, ref: crypto.randomUUID() });
        refresh(n => n + 1);
      }
      return saved.current;
    },
    frozen<T extends object>(): T | null { return saved.current === null ? null : JSON.parse(saved.current) as T; },
    clear(): void { saved.current = null; refresh(n => n + 1); },
    pending(): boolean { return saved.current !== null; },
  };
}

/**
 * Whether a status can settle an attempt, together with retryUncommitted. Only an
 * answer given after the server looked the reference up says the first try
 * did not commit. A rate limit (429), a timeout (408, 425) or a sign-in that
 * lapsed (401, 403) is answered before that. Cleared on a 429, a lost MX$100
 * pay-later order was created again under a new reference once the limit
 * passed. Keeping a reference is always safe; dropping it early is what
 * duplicates.
 */
export function refusalSettles(status: number): boolean {
  return status >= 400 && status < 500 && ![401, 402, 403, 408, 425, 429].includes(status);
}
