import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutScope, type CheckoutPageScope } from "@/lib/checkout-page-scope";
import { resolveCheckoutPages } from "@/lib/whole-bill-pages";

type RpcResult = Awaited<ReturnType<ReturnType<typeof createAdminClient>["rpc"]>>;

/** Keep the refusal unless Stripe proves closure; retry the very same decision once. */
export async function checkoutPageRpc(name: string, args: Record<string, unknown>, scope: CheckoutPageScope = checkoutScope(args)): Promise<RpcResult> {
  const db = createAdminClient();
  const result = await db.rpc(name, args);
  const data = result.data;
  const accountHold = name === "prepare_order_refund" && args.p_expected_account && data?.outcome === "changed";
  const paying = accountHold || data === "paying" || data?.outcome === "paying"
    || (Array.isArray(data) && data.some(row => row.outcome === "paying")) || ["paying", "checkout_scope_busy"].includes(result.error?.message ?? "");
  const record = args.p_record as { restaurant_id?: unknown } | undefined;
  const restaurantId = args.p_restaurant ?? record?.restaurant_id;
  if (!paying || typeof restaurantId !== "string") return result;
  if (await resolveCheckoutPages(restaurantId, scope) !== "closed") return result;
  return await db.rpc(name, args);
}
