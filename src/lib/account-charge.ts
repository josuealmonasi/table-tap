import type { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/format";

/** What `account_charge()` answered. */
export type ChargeResult =
  | { outcome: "charged"; amount: number; owed: number }
  | { outcome: "limit"; owed: number; limit: number }
  | { outcome: "closed" | "stale" | "partly_paid" | "paying" };

/**
 * Puts orders on an account, under the account's lock in the database. Shared
 * by the bill's "put it on the account" and by a sale rung at the till, so
 * the ceiling and the refusals are the same wherever the food goes out.
 */
export async function chargeAccount(
  restaurantId: string,
  accountId: string,
  orderIds: string[],
  expected: number,
  actor: string,
): Promise<ChargeResult> {
  const { data, error } = await createAdminClient().rpc("account_charge", {
    p_restaurant: restaurantId,
    p_account: accountId,
    p_orders: orderIds,
    p_expected: expected,
    p_actor: actor,
  });
  if (error) throw new Error(`Could not charge the account: ${error.message}`);
  const r = data as { outcome: string; amount?: number; owed?: number; limit?: number };
  if (r.outcome === "charged") return { outcome: "charged", amount: Number(r.amount), owed: Number(r.owed) };
  if (r.outcome === "limit") return { outcome: "limit", owed: Number(r.owed), limit: Number(r.limit) };
  return { outcome: r.outcome as "closed" | "stale" | "partly_paid" | "paying" };
}

/** The sentence for a charge the database turned down — each one says what to do. */
export async function chargeRefusal(
  result: Exclude<ChargeResult, { outcome: "charged" }>,
  currency: string,
): Promise<NextResponse> {
  switch (result.outcome) {
    case "limit":
      return await apiError("apiErr.accountOverLimit", 409, {
        owed: formatMoney(result.owed, currency),
        limit: formatMoney(result.limit, currency),
      });
    case "closed":
      return await apiError("apiErr.accountClosed", 409);
    case "partly_paid":
      return await apiError("apiErr.accountPartlyPaid", 409);
    case "paying":
      return await apiError("apiErr.accountBillPaying", 409);
    default:
      return await apiError("apiErr.accountBillChanged", 409);
  }
}

/** The restaurant's currency, for the amounts a refusal names. */
export async function currencyOf(restaurantId: string): Promise<string> {
  const { data } = await createAdminClient().from("restaurants").select("currency").eq("id", restaurantId).maybeSingle();
  return (data?.currency as string | undefined) ?? "MXN";
}
