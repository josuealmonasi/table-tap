import { createAdminClient } from "@/lib/supabase/admin";
import { stockDemand, toDemandPayload, type StockWarning, type StockShortfall } from "@/lib/stock";
import type { OrderLineItem } from "@/lib/types";

export interface OrderIntent {
  restaurantId: string;
  ref: string;
  scope: string;
}

export interface OrderIntentResult {
  orderId: string;
  sessionId: string | null;
  table: string | null;
  total: number;
  repeat?: boolean;
  conflict?: boolean;
  couponReason?: string;
  short?: StockShortfall[];
  low?: StockWarning[];
}

/** Only the same restaurant and ordering surface may retrieve an intent. */
export async function readOrderIntent(intent: OrderIntent): Promise<OrderIntentResult | null> {
  const { data, error } = await createAdminClient().rpc("order_intent_result", {
    p_restaurant: intent.restaurantId, p_ref: intent.ref, p_scope: intent.scope,
  });
  if (error) throw new Error(`Order retry lookup failed: ${error.message}`);
  return data as OrderIntentResult | null;
}

/** Stock, the coupon use and the kitchen ticket commit once, together. */
export async function writeOrderIntent(intent: OrderIntent, input: {
  order: object;
  lines: OrderLineItem[];
  inventory: boolean;
  threshold: number;
  coupon?: object | null;
}): Promise<OrderIntentResult> {
  const { data, error } = await createAdminClient().rpc("create_order_intent", {
    p_restaurant: intent.restaurantId, p_ref: intent.ref, p_scope: intent.scope,
    p_order: input.order, p_demand: toDemandPayload(stockDemand(input.lines)),
    p_inventory: input.inventory, p_threshold: input.threshold, p_coupon: input.coupon ?? null,
  });
  if (error || !data) throw new Error(`Order could not be recorded: ${error?.message ?? "no result"}`);
  return data as OrderIntentResult;
}
