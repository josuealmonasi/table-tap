import { createHmac, timingSafeEqual } from "node:crypto";
import type { ReceiptOrder, SlotReceiptPayment } from "@/lib/receipt";

type FinancialCopy = Pick<ReceiptOrder, "id" | "total" | "tip" | "service_fee" | "currency" | "forgiveness" | "return_components" | "returns">;
function signature(body: string): string {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("Could not sign the receipt version");
  return createHmac("sha256", secret).update(`receipt-version-v1|${body}`).digest("base64url");
}

/** Freeze the server's financial copy. Reprinting it after another return (or
 * a later provider failure) must not rewrite the paper already handed out. */
export function sealReceiptVersion(restaurant: string, orders: ReceiptOrder[]): string {
  const copies: FinancialCopy[] = orders.map(({ id, total, tip, service_fee, currency, forgiveness, return_components, returns }) =>
    ({ id, total, tip, service_fee, currency, forgiveness, return_components, returns }));
  const body = Buffer.from(JSON.stringify({ restaurant, orders: copies })).toString("base64url");
  return `${body}.${signature(body)}`;
}
export function openReceiptVersion(token: string, restaurant: string, orders: ReceiptOrder[]): ReceiptOrder[] | null {
  if (typeof token !== "string" || token.length > 250000) return null;
  const [body, given, extra] = token.split(".");
  if (!body || !given || extra || !/^[A-Za-z0-9_-]+$/.test(given)) return null;
  const wanted = signature(body);
  if (given.length !== wanted.length || !timingSafeEqual(Buffer.from(given), Buffer.from(wanted))) return null;
  try {
    const saved = JSON.parse(Buffer.from(body, "base64url").toString()) as { restaurant: string; orders: FinancialCopy[] };
    if (saved.restaurant !== restaurant || saved.orders.length !== orders.length
      || saved.orders.some((copy, i) => copy.id !== orders[i].id || copy.currency !== orders[i].currency)) return null;
    return orders.map((order, i) => ({ ...order, ...saved.orders[i] }));
  } catch { return null; }
}

export function sealSlotVersion(restaurant: string, payment: SlotReceiptPayment): string {
  const body = Buffer.from(JSON.stringify({ restaurant, payment })).toString("base64url");
  return `${body}.${signature(body)}`;
}
export function openSlotVersion(token: string, restaurant: string, payment: SlotReceiptPayment): SlotReceiptPayment | null {
  if (typeof token !== "string" || token.length > 250000) return null;
  const [body, given, extra] = token.split(".");
  if (!body || !given || extra || !/^[A-Za-z0-9_-]+$/.test(given)) return null;
  const wanted = signature(body);
  if (given.length !== wanted.length || !timingSafeEqual(Buffer.from(given), Buffer.from(wanted))) return null;
  try {
    const saved = JSON.parse(Buffer.from(body, "base64url").toString()) as { restaurant: string; payment: SlotReceiptPayment };
    return saved.restaurant === restaurant && saved.payment.id === payment.id && saved.payment.currency === payment.currency ? saved.payment : null;
  } catch { return null; }
}
