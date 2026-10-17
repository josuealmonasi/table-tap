import { randomUUID } from "node:crypto";
import { apiError } from "@/lib/api-error";
import { recoverBillingClaim } from "@/lib/billing-recovery";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;
export class BillingError extends Error {
  constructor(public key: string, public status = 409) { super(key); }
}
export interface BillingOperation {
  token: string;
  record(state: object): Promise<void>;
  write<T>(action: () => Promise<T>): Promise<T>;
}

// A process-local lock lets two server instances charge the same restaurant.
// An expired claim can be recovered after Stripe reconciliation. Every write
// checks its token again so a resumed old worker cannot start another charge.
export async function withRestaurantBilling<T>(
  db: Db, restaurantId: string, action: (operation: BillingOperation) => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  const { data, error } = await db.rpc("claim_restaurant_billing", {
    p_restaurant: restaurantId, p_token: token,
  });
  if (error) throw new Error(`Billing lock failed: ${error.message}`);
  if (!data) await recoverBillingClaim(db, restaurantId, token);
  const record = async (state: object) => {
    const { data: held, error } = await db.rpc("record_restaurant_billing", {
      p_restaurant: restaurantId, p_token: token, p_state: state,
    });
    if (error) throw new Error(`Billing record failed: ${error.message}`);
    if (!held) throw new BillingError("apiErr.billingBusy");
  };
  let uncertain = false;
  let release = false;
  try {
    const result = await action({ token, record, write: async action => {
      await record({});
      uncertain = true;
      return await action();
    } });
    release = true;
    return result;
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode;
    // A Stripe refusal made no change. Network failures and 409s can still
    // have a request running, so recovery must reconcile them before retrying.
    release = !uncertain || (typeof status === "number" && status >= 400 && status < 500 && status !== 409);
    throw err;
  } finally {
    if (release) {
      // A known checkout URL still lets the owner pay. Failed cleanup can be
      // recovered later; it must not replace that successful response.
      try {
        const { error } = await db.rpc("release_restaurant_billing", { p_restaurant: restaurantId, p_token: token });
        if (error) console.error("Billing unlock failed", restaurantId, error.message);
      } catch (err) {
        console.error("Billing unlock failed", restaurantId, err);
      }
    }
  }
}

export async function billingFailure(err: unknown) {
  if (err instanceof BillingError) return await apiError(err.key, err.status);
  if ((err as { statusCode?: number })?.statusCode === 402) return await apiError("apiErr.billingPaymentFailed", 402);
  console.error("restaurant billing failed", err);
  return await apiError("apiErr.billingUnavailable", 502);
}
