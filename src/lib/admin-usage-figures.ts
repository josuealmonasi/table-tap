import { startOfLocalMonth, subtractLocalDays } from "@/lib/day-window";
import { salesRevenue, type RevenueOrder } from "@/lib/report-revenue";
import { receiptCents } from "@/lib/receipt-amount";

const ZONE = "America/Mexico_City";
interface Sale extends RevenueOrder { id: string; currency: string; created_at: string }
interface Payment { currency: string; amount: number | string; method: string; created_at: string }
interface Returned { currency: string; amount_cents: number; tip_cents: number; succeeded_at: string; kind: string }
interface Fee { currency: string | null; cents: number; refunded_cents: number; settled_at: string }
export interface UsageInput { orders: Sale[]; payments: Payment[]; returns: Returned[]; fees: Fee[] }

export function usageWindows(now: Date): { last30: string; month: string; end: string } {
  return { last30: subtractLocalDays(now, 29, ZONE).toISOString(), month: startOfLocalMonth(now, ZONE).toISOString(), end: now.toISOString() };
}

export function usageFigures(input: UsageInput, start: string, end: string) {
  const within = (date: string): boolean => Date.parse(date) >= Date.parse(start) && Date.parse(date) < Date.parse(end);
  const sales = new Map<string, number>();
  const tips = new Map<string, number>();
  const payments = new Map<string, { cash: number; card: number }>();
  const fees = new Map<string | null, number>();
  const orders = input.orders.filter(o => within(o.created_at));
  for (const order of orders) {
    sales.set(order.currency, (sales.get(order.currency) ?? 0) + receiptCents(salesRevenue(order)));
    tips.set(order.currency, (tips.get(order.currency) ?? 0) + receiptCents(Number(order.tip) + Number(order.return_components?.tip ?? 0)));
  }
  for (const event of input.returns.filter(r => r.kind === "return" && within(r.succeeded_at))) {
    sales.set(event.currency, (sales.get(event.currency) ?? 0) - event.amount_cents + event.tip_cents);
    tips.set(event.currency, (tips.get(event.currency) ?? 0) - event.tip_cents);
  }
  for (const payment of input.payments.filter(p => within(p.created_at))) {
    const row = payments.get(payment.currency) ?? { cash: 0, card: 0 };
    if (payment.method === "cash" || payment.method === "card") row[payment.method] += receiptCents(payment.amount);
    payments.set(payment.currency, row);
  }
  for (const fee of input.fees.filter(f => within(f.settled_at))) fees.set(fee.currency, (fees.get(fee.currency) ?? 0) + fee.cents - fee.refunded_cents);
  return { orders: orders.length, sales: [...sales].map(([currency, cents]) => ({ currency, amount: cents / 100 })),
    tips: [...tips].map(([currency, cents]) => ({ currency, amount: cents / 100 })),
    payments: [...payments].map(([currency, p]) => ({ currency, cash: p.cash / 100, card: p.card / 100 })),
    fees: [...fees].map(([currency, cents]) => ({ currency, amount: cents / 100 })) };
}
