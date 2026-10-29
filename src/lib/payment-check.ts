import { splitSelection, splitUuid } from "@/lib/split-slots";
import { isDinerCurrency } from "@/lib/diner-currency";

export type PaymentCheckScope =
  | { kind: "orders"; orderIds: string[] }
  | { kind: "table"; tableId: string; currency: string }
  | { kind: "account"; accountId: string }
  | { kind: "split"; splitId: string; slots?: number[] }
  | { kind: "approval"; requestId: string; requestKind: "discount" | "writeOff" };

export type PaymentCheckOutcome = "closed" | "paid" | "unverified" | "missing_identity";
export function isPaymentCheckOutcome(value: unknown): value is PaymentCheckOutcome {
  return ["closed", "paid", "unverified", "missing_identity"].includes(String(value));
}

/** Accept one scope; browser-supplied tenant and checkout identities have no authority. */
export function paymentCheckScope(value: unknown): PaymentCheckScope | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.kind === "orders" && Array.isArray(v.orderIds) && v.orderIds.length > 0 && v.orderIds.length <= 200
    && new Set(v.orderIds).size === v.orderIds.length && v.orderIds.every(splitUuid)) return { kind: v.kind, orderIds: v.orderIds };
  if (v.kind === "table" && splitUuid(v.tableId) && isDinerCurrency(v.currency)) return { kind: v.kind, tableId: v.tableId, currency: v.currency };
  if (v.kind === "account" && splitUuid(v.accountId)) return { kind: v.kind, accountId: v.accountId };
  if (v.kind === "split" && splitUuid(v.splitId) && (v.slots === undefined || splitSelection(v.slots))) {
    return { kind: v.kind, splitId: v.splitId, ...(v.slots !== undefined && { slots: v.slots as number[] }) };
  }
  if (v.kind === "approval" && splitUuid(v.requestId) && ["discount", "writeOff"].includes(String(v.requestKind))) {
    return { kind: v.kind, requestId: v.requestId, requestKind: v.requestKind as "discount" | "writeOff" };
  }
  return null;
}
