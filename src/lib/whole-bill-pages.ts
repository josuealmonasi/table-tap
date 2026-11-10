import { matchesDinerCheckout, type DinerCheckoutRecord } from "@/lib/diner-checkout";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutOrderIds, checkoutRows, checkoutRowsIn, checkoutScope, type CheckoutPageScope } from "@/lib/checkout-page-scope";

export type CheckoutPageResolution = "closed" | "unresolved" | "unverified" | "paid" | "missing_identity";
interface Page extends Omit<DinerCheckoutRecord, "stripe_session_id" | "stripe_account_id" | "metadata"> {
  id: string; status?: string; stripe_session_id: string | null; stripe_account_id: string | null;
  split_id: string | null; metadata: Record<string, string> | null; scope_key: string | null; created_at: string;
}
interface AccountPage { id: string; stripe_session_id: string | null; created_at: string }

async function closePage(restaurantId: string, page: Page, statusOnly: boolean): Promise<CheckoutPageResolution> {
  if (page.status === "paid") return statusOnly ? "paid" : "unresolved";
  if (!page.stripe_account_id) return statusOnly ? "missing_identity" : "unverified";
  // Checking a payment must never open a payable page, even with a saved key.
  if (statusOnly && !page.stripe_session_id) return "missing_identity";
  const db = createAdminClient();
  // Loaded only when a page must be read: every split route imports this module.
  const { stripe } = await import("@/lib/stripe");
  if (!page.stripe_session_id) {
    // Saved, but its Stripe page was never bound (the process stopped
    // between the two). Resending its saved request returns that same page
    // while Stripe still keeps the key (24h), binds it, and closes it if it
    // expired. Older than that, nothing here can prove it never charged.
    const age = Date.now() - new Date(page.created_at).getTime();
    if (!page.scope_key || !Number.isFinite(age) || age < 0 || age > 23 * 3600 * 1000) return "unverified";
    const { resumeDinerAttempt } = await import("@/lib/diner-attempt");
    await resumeDinerAttempt(stripe, restaurantId, page.scope_key, page.id);
    const { data: now, error } = await db.from("diner_checkouts").select("status")
      .eq("id", page.id).eq("restaurant_id", restaurantId).maybeSingle();
    if (error || !now) return "unverified";
    return now.status === "expired" ? "closed" : "unresolved";
  }
  const session = await stripe.checkout.sessions.retrieve(page.stripe_session_id, {}, { stripeAccount: page.stripe_account_id });
  // A paid page belongs to the verified webhook, even when its answer is late.
  if (!matchesDinerCheckout(session, { ...page, stripe_session_id: page.stripe_session_id, stripe_account_id: page.stripe_account_id, metadata: page.metadata ?? {} })) return "unverified";
  if (statusOnly && session.payment_status === "paid") return "paid";
  if (session.status !== "expired" || session.payment_status !== "unpaid") return "unresolved";
  if (page.metadata?.order_id) {
    // A pay-now cart still owns stock. Its complete expiry path returns that
    // stock and its coupon before another checkout may use the reference.
    const { abandonCheckout } = await import("@/lib/checkout-abandon");
    await abandonCheckout(session, { account: page.stripe_account_id, livemode: page.livemode });
  } else if (page.metadata?.split_model === "2") {
    const { data, error } = await db.rpc("retire_split_attempt_v1", { p_restaurant: restaurantId, p_checkout: page.id });
    if (error || !["retired", "gone", "paid"].includes(data?.outcome)) return "unverified";
    if (data.outcome === "paid") return statusOnly ? "paid" : "unresolved";
  } else {
    const { error } = await db.rpc("finish_diner_checkout", { p_attempt: page.id, p_paid: false });
    if (error) throw new Error("Could not close the unpaid checkout");
  }
  return "closed";
}

/** Read the exact saved page and account; time passing is never proof of expiry. */
export async function resolveCheckoutPages(restaurantId: string, scope: CheckoutPageScope, statusOnly = false): Promise<CheckoutPageResolution> {
  try {
    const db = createAdminClient();
    const { checkoutIds, accountId } = scope;
    const orderIds = scope.checkoutIds ? [] : await checkoutOrderIds(restaurantId, scope);
    if (!orderIds.length && !scope.accountId && !scope.checkoutIds?.length) return "unverified";
    const diners = () => {
      const query = db.from("diner_checkouts").select("*").eq("restaurant_id", restaurantId).eq("status", "open");
      return scope.includeParts === false ? query.is("split_id", null) : query;
    };
    const pages = checkoutIds
      ? await checkoutRows<Page>((start, end) => diners().in("id", checkoutIds).order("id").range(start, end))
      : await checkoutRowsIn<Page>(orderIds, (ids, start, end) => diners().overlaps("order_ids", ids).order("id").range(start, end));
    const accounts = () => db.from("account_checkouts").select("id, stripe_session_id, created_at")
      .eq("restaurant_id", restaurantId).eq("status", "open");
    const accountPages = checkoutIds ? [] : accountId
      ? await checkoutRows<AccountPage>((start, end) => accounts().eq("account_id", accountId).order("id").range(start, end))
      : await checkoutRowsIn<AccountPage>(orderIds, (ids, start, end) => accounts().overlaps("order_ids", ids).order("id").range(start, end));
    if (scope.checkoutIds && pages.length !== new Set(scope.checkoutIds).size) return "unverified";
    const results = new Map<string, CheckoutPageResolution>();
    for (const page of pages) {
      if (scope.checkoutIds && scope.splitId && (page.split_id !== scope.splitId
        || page.metadata?.split_id !== scope.splitId || page.metadata?.split_model !== "2")) return "unverified";
      // A part's own page must not block cash for another part of its split.
      if (scope.includeParts === false && (page.split_id || page.metadata?.split_model === "2")) continue;
      results.set(page.id, await closePage(restaurantId, page, statusOnly));
    }
    for (const account of accountPages) {
      let page = pages.find(p => p.metadata?.account_checkout === account.id);
      if (!page) {
        // Older account rows carry no connected account. Only their durable
        // diner attempt can supply it; today's restaurant connection cannot.
        const { data, error } = await db.from("diner_checkouts").select("*")
          .eq("restaurant_id", restaurantId).contains("metadata", { account_checkout: account.id }).maybeSingle();
        if (error) return "unverified";
        if (!data) {
          if (statusOnly) return "missing_identity";
          // No diner attempt was ever saved for it, and one is always saved
          // before Stripe is called: this account page never reached Stripe and
          // cannot have charged. After ten minutes no request can still be about
          // to save one, so it is released rather than blocking the account for
          // good (a crash between the two writes left exactly this).
          const { data: released, error: releaseError } = await db.rpc("release_unreached_account_page_v1",
            { p_restaurant: restaurantId, p_checkout: account.id });
          if (releaseError) return "unverified";
          if (!released) return "unresolved";
          results.set(`account:${account.id}`, "closed");
          continue;
        }
        page = data as Page;
      }
      if (account.stripe_session_id && account.stripe_session_id !== page.stripe_session_id) return "unverified";
      const resolution = results.get(page.id) ?? await closePage(restaurantId, page, statusOnly);
      results.set(page.id, resolution);
      if (resolution === "closed") {
        const { releaseAccountCheckout } = await import("@/lib/account-checkout");
        await releaseAccountCheckout(account.id);
      }
    }
    if (!results.size) return statusOnly ? "missing_identity" : "unverified";
    // A paid page is never called closed, even if another page could not be read.
    if ([...results.values()].includes("paid")) return "paid";
    if ([...results.values()].includes("missing_identity")) return "missing_identity";
    if ([...results.values()].includes("unverified")) return "unverified";
    return [...results.values()].includes("unresolved") ? "unresolved" : "closed";
  } catch (err) {
    // Stripe unreachable is not proof the page cannot charge.
    console.error("could not resolve an unconfirmed card page", err);
    return "unverified";
  }
}

/**
 * A divided bill refuses with "paying" while a whole-bill card page is open on
 * its orders: Stripe may have charged it with the webhook still on its way.
 * Ask Stripe about each such page; one Stripe says expired is closed exactly as
 * its expiry webhook would. Answers whether the blocking pages were closed, so
 * the caller retries once. Open or paid pages, and any read failure, leave the refusal.
 */
export async function closeExpiredWholeBillPages(restaurantId: string, args: Record<string, unknown>): Promise<boolean> {
  return await resolveCheckoutPages(restaurantId, { ...checkoutScope(args), includeParts: false }) === "closed";
}
