import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileChargeFee } from "./charge-reconciler";

export async function syncReturnedFee(client: Stripe, restaurantId: string, intentId: string, account: string, db = createAdminClient()): Promise<void> {
  if (!await reconcileChargeFee(db, client, restaurantId, intentId, account)) {
    throw new Error("The returned fee remains pending reconciliation");
  }
}
