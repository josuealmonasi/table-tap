import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow, everyRowIn } from "@/lib/paged";
import { withReturnComponents } from "@/lib/return-components";
import { readReturnEvents, type ReturnEvent } from "@/lib/refunds/events";
import { returnTips } from "@/lib/admin-usage-returns";
import { usageFigures, usageWindows } from "@/lib/admin-usage-figures";
import type { RevenueOrder } from "@/lib/report-revenue";

interface Order extends RevenueOrder { id: string; currency: string; created_at: string }
interface Payment { currency: string; amount: number; method: string; created_at: string }
interface Fee { cents: number; refunded_cents: number; stripe_payment_intent: string | null; settled_at: string }
interface Operation { id: string; amount: number; tip: number; currency: string; order_adjustments: { order_id: string; kind: string } }

export async function readAdminUsage(restaurant: string, now = new Date()) {
  const db = createAdminClient();
  const windows = usageWindows(now), start = windows.last30 < windows.month ? windows.last30 : windows.month;
  const [exists, orders, payments, fees, current, staff, latest, signIn] = await Promise.all([
    db.from("restaurants").select("id").eq("id", restaurant).maybeSingle(),
    // Match analytics/page.tsx: sales belong to the order's creation day.
    everyRow<Order>((a, b) => db.from("orders").select("id, currency, total, tip, service_fee, items, created_at")
      .eq("restaurant_id", restaurant).eq("paid", true).neq("status", "cancelled")
      .gte("created_at", start).lt("created_at", windows.end).order("id").range(a, b), "the period's sales"),
    everyRow<Payment>((a, b) => db.from("payments").select("currency, amount, method, created_at")
      .eq("restaurant_id", restaurant).gte("created_at", start).lt("created_at", windows.end).order("id").range(a, b), "the period's payments"),
    everyRow<Fee>((a, b) => db.from("platform_fees").select("cents, refunded_cents, stripe_payment_intent, settled_at")
      .eq("restaurant_id", restaurant).eq("status", "taken").gte("settled_at", start).lt("settled_at", windows.end).order("id").range(a, b), "the period's fees"),
    readReturnEvents(db, restaurant, start, windows.end, { kind: "return" }),
    db.from("staff").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant),
    db.from("orders").select("created_at").eq("restaurant_id", restaurant).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.rpc("admin_restaurant_last_sign_in_v1", { p_restaurant: restaurant }),
  ]);
  if (exists.error || staff.error || latest.error || signIn.error || staff.count === null) throw new Error("Could not read restaurant usage");
  if (!exists.data) return null;
  const [restored, checkouts, operations, pieces] = await Promise.all([
    withReturnComponents(db, restaurant, orders),
    everyRowIn<{ stripe_payment_intent: string; currency: string }>(fees.flatMap(f => f.stripe_payment_intent ? [f.stripe_payment_intent] : []),
      (ids, a, b) => db.from("diner_checkouts").select("stripe_payment_intent, currency").eq("restaurant_id", restaurant)
        .in("stripe_payment_intent", ids).order("id").range(a, b), "the fees' charge currencies"),
    everyRowIn<Operation>(current.map(e => e.operation_id), (ids, a, b) => db.from("refund_operations")
      .select("id, amount, tip, currency, order_adjustments!inner(order_id, kind)")
      .eq("restaurant_id", restaurant).in("id", ids).order("id").range(a, b).overrideTypes<Operation[], { merge: false }>(), "the return operations"),
    everyRowIn<ReturnEvent>(current.map(e => e.operation_id), (ids, a, b) => db.rpc("order_return_events_v1", {
      p_restaurant: restaurant, p_currency: null,
    }).in("operation_id", ids).eq("kind", "return").lt("succeeded_at", windows.end).order("id").range(a, b), "the return pieces"),
  ]);
  const operationById = new Map(operations.map(o => [o.id, o]));
  if (pieces.some(e => { const op = operationById.get(e.operation_id); return !op || op.currency !== e.currency || op.order_adjustments.order_id !== e.order_id || op.order_adjustments.kind !== "return"; })) throw new Error("The return does not match its sale");
  const tips = returnTips(operations, pieces);
  const currencies = new Map(checkouts.map(c => [c.stripe_payment_intent, c.currency]));
  const input = { orders: restored, payments, returns: current.map(e => {
    const tip = tips.get(e.id);
    if (tip === undefined) throw new Error("Could not verify the return tip");
    return { ...e, tip_cents: tip };
  }), fees: fees.map(f => ({ ...f, currency: f.stripe_payment_intent ? currencies.get(f.stripe_payment_intent) ?? null : null })) };
  const activity = [latest.data?.created_at, signIn.data].filter((v): v is string => typeof v === "string").sort().at(-1) ?? null;
  return { staff: staff.count, lastActivity: activity, last30: usageFigures(input, windows.last30, windows.end), month: usageFigures(input, windows.month, windows.end) };
}
