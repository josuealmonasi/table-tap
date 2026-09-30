import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api-error";
import { orderCode } from "@/lib/types";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { accountById } from "@/lib/accounts-server";
import { chargeAccount, chargeRefusal, currencyOf } from "@/lib/account-charge";

interface RingOnAccount {
  restaurantId: string;
  accountId: string;
  orderId: string;
  total: number;
  actor: string;
  /** Puts the sale's stock back if the account turns it down. */
  release: () => Promise<unknown>;
}

/**
 * A sale rung at the till onto a customer's account. The order already exists
 * (unpaid); the account takes it under its lock, or turns it down — over its
 * ceiling, or closed — and then the sale is taken back out entirely, stock
 * and all, so nothing is left owed by nobody.
 */
export async function ringOnAccount(sale: RingOnAccount): Promise<NextResponse> {
  const db = createAdminClient();
  const account = await accountById(sale.restaurantId, sale.accountId).catch(() => null);
  const result = account
    ? await chargeAccount(sale.restaurantId, account.id, [sale.orderId], sale.total, sale.actor).catch(() => null)
    : null;

  if (!account || !result || result.outcome !== "charged") {
    await db.from("orders").delete().eq("id", sale.orderId).eq("restaurant_id", sale.restaurantId);
    await sale.release();
    if (account && result && result.outcome !== "charged") {
      return await chargeRefusal(result, await currencyOf(sale.restaurantId));
    }
    return await apiError(account ? "apiErr.generic" : "apiErr.notFound", account ? 500 : 404);
  }

  await logEvent({
    restaurantId: sale.restaurantId,
    actor: sale.actor,
    entity: "account",
    action: "charged",
    detail: logDetail({
      name: account.name,
      code: orderCode(sale.orderId),
      amount: result.amount.toFixed(2),
      owed: result.owed.toFixed(2),
    }),
  });
  return NextResponse.json({
    orderId: sale.orderId,
    code: orderCode(sale.orderId),
    total: sale.total,
    onAccount: { name: account.name, owed: result.owed },
  });
}
