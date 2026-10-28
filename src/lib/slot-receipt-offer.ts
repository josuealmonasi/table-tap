import type { SplitScope } from "@/lib/split-slots";

export interface SlotReceiptTarget { paymentId: string; splitId: string; slots: number[] }
export interface PendingSlotReceipt extends SplitScope { splitId: string; slots: number[] }
export const SLOT_SETTLING = "tt.settling.slots";

export function readReceiptMemory<T>(key: string, fallback: T): T {
  try { return JSON.parse(sessionStorage.getItem(key) ?? "null") ?? fallback; }
  catch { return fallback; }
}
export function writeReceiptMemory(key: string, value: unknown): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* A receipt must never stop somebody paying when their phone cannot remember it. */ }
}
export function rememberSlotSettling(pending: PendingSlotReceipt): void {
  writeReceiptMemory(SLOT_SETTLING, { ...pending, slots: [...pending.slots].sort((a, b) => a - b) });
}
