"use client";

import { membershipDeadline } from "@/lib/membership-read";
import type { JoinState } from "@/lib/table-membership";
import type { PendingPhone } from "@/lib/table-member-requests";

export interface PhoneMembership extends JoinState {
  pass: string;
  /** Null is a failed secondary read; older replies may omit this field. */
  pending?: PendingPhone[] | null;
}
let reading: Promise<void> = Promise.resolve();

/**
 * Two first loads must not each replace the HttpOnly cookie: the later reply
 * could erase the credential whose order just reached the kitchen. Serialize
 * within this page, and across tabs where the browser provides Web Locks.
 */
export function requestPhoneMembership(restaurantId: string, tableId: string, signal?: AbortSignal): Promise<PhoneMembership> {
  async function read(signal: AbortSignal): Promise<PhoneMembership> {
    try {
      const res = await fetch("/api/table-membership", {
        signal,
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId, tableId }),
      });
      if (!res.ok) throw new Error("Admission request refused");
      return await res.json() as PhoneMembership;
    } catch (cause) {
      // The hook reports this through the dictionaries; a refused read never
      // stands in for an empty table or a decision the phone did not receive.
      throw new Error("Could not check admission", { cause });
    }
  }
  const run = (): Promise<PhoneMembership> => membershipDeadline(async attemptSignal =>
    typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request("tt-table-member", { signal: attemptSignal }, () => read(attemptSignal))
      : await read(attemptSignal), signal);
  const next = reading.then(run, run);
  reading = next.then(() => {}, () => {});
  return next;
}
