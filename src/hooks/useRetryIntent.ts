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
