import { apiError } from "@/lib/api-error";

/**
 * A suspended restaurant (a platform admin's decision: non-payment, abuse, an
 * owner's request) starts no new sales. One answer everywhere a sale starts,
 * so the screens can say the same thing.
 */
export async function suspensionRefusal(suspendedAt: unknown) {
  return suspendedAt ? await apiError("apiErr.restaurantSuspended", 409) : null;
}

/**
 * The till's answer while suspended. A new sale is refused. Money the till
 * already collected is never lost: collected before the suspension, it is
 * recorded as usual (null here); collected after it — the device was offline
 * and could not know — it stays on the device as held, for a manager to
 * resolve, the way every collected sale the server cannot settle does.
 */
export async function posSuspensionAnswer(suspendedAt: unknown, collectedAt: string | null) {
  if (!suspendedAt) return null;
  if (!collectedAt) return await apiError("apiErr.restaurantSuspended", 409);
  if (new Date(collectedAt).getTime() < new Date(String(suspendedAt)).getTime()) return null;
  return await apiError("apiErr.restaurantSuspended", 409, undefined, { held: true });
}
