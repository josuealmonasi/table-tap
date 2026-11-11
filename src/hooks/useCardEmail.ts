"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

export interface CardEmailData { email: string | null }
async function read(url: string): Promise<CardEmailData> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error("Could not read the card email");
  const data = await res.json();
  if (data.email !== null && typeof data.email !== "string") throw new Error("Missing card email");
  return data;
}

/** Each reader starts fresh: a cashier must never flash an owner's cached full address. */
export function useCardRead<Data>(url: string | null, read: (url: string) => Promise<Data>, refreshInterval = 0) {
  const [reader] = useState(() => crypto.randomUUID());
  const { mutate: refreshReaders } = useSWRConfig();
  const result = useSWR(url ? [url, reader] : null, ([url]) => read(url), { refreshInterval });
  async function publish(data: Data, revalidate = false): Promise<void> {
    await result.mutate(data, { revalidate });
    // Other readers fetch their own role-filtered answer; never broadcast a typed address.
    void Promise.resolve(refreshReaders(key => Array.isArray(key) && key[0] === url && key[1] !== reader)).catch(() => undefined);
  }
  return { ...result, publish };
}

/** Keep only the server's role-filtered answer; never cache the address typed by staff. */
export function useCardEmail(code?: string | null) {
  return useCardRead(code ? `/api/loyalty/card-email?code=${encodeURIComponent(code)}` : null, read);
}
