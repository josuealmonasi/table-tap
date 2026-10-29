import { receiptCents } from "@/lib/receipt-amount";
import type { Order } from "@/lib/types";

/**
 * What a table still owes, in cents: the rest of part-paid orders and the whole
 * of unpaid ones. Each amount is rounded to cents before subtracting, exactly
 * as write_off_remainder_v1 counts them: subtracting first gave 67 cents for an
 * unscaled 2.675 less 2.00 where Postgres gave 68 (write-off audit #8).
 */
export function owedCents(orders: Pick<Order, "id" | "total">[], paid: Map<string, number>): number {
  return orders.reduce((sum, o) => {
    const covered = paid.get(o.id) ?? 0;
    const total = receiptCents(o.total);
    return sum + (covered <= 0 ? total : Math.max(total - receiptCents(covered), 0));
  }, 0);
}

