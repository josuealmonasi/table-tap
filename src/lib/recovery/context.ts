import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { JOB_BUDGET_MS, type RecoveryContext } from "./job";

/** Bound the network requests too, rather than only racing a local timer.
 * A timed-out write may still finish remotely, so every retry must continue
 * through the existing locked writers and immutable provider requests. */
export function recoveryContext(): RecoveryContext {
  const deadline = Date.now() + JOB_BUDGET_MS;
  const requestFetch: typeof fetch = (input, init) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return Promise.reject(new Error("Recovery deadline reached"));
    const timeout = AbortSignal.timeout(Math.min(1500, remaining));
    const original = init?.signal ?? (input instanceof Request ? input.signal : null);
    return fetch(input, { ...init, signal: original ? AbortSignal.any([original, timeout]) : timeout });
  };
  return { deadline, db: createAdminClient(requestFetch), client: new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-08-27.basil", typescript: true, maxNetworkRetries: 0, timeout: 1500,
    httpClient: Stripe.createFetchHttpClient(requestFetch),
  }) };
}
