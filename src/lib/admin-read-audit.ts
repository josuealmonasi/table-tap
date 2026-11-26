import "server-only";
import { randomUUID } from "node:crypto";
import type { PlatformAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/** Which admin screen read the restaurant. Named in the audit; nothing it read is. */
export type AdminReadView = "usage" | "notes";

export type AuditedRead<T> = { audited: true; value: T | null } | { audited: false };

/**
 * A platform admin reads one restaurant's private figures (sales, support
 * notes). Like `auditedOwnerView`: a `restaurant.view` row is written before
 * the read, and when it cannot be, nothing is read. The audit names the
 * restaurant and the view, never the figures or the note text.
 */
export async function auditedAdminRead<T>(
  admin: PlatformAdmin, restaurantId: string, view: AdminReadView, read: () => Promise<T | null>,
): Promise<AuditedRead<T>> {
  const db = createAdminClient();
  const attemptId = randomUUID();
  const record = async (outcome: "started" | "succeeded" | "refused" | "uncertain"): Promise<boolean> => {
    const { error } = await db.from("platform_admin_audit").insert({
      attempt_id: attemptId, actor_id: admin.userId, actor_email: admin.email,
      target_type: "restaurant", target_id: restaurantId, action: "restaurant.view", outcome,
      before_facts: {}, after_facts: { read_only: true, view },
    });
    return !error;
  };

  if (!(await record("started"))) return { audited: false };
  let value: T | null;
  try {
    value = await read();
  } catch (error) {
    await record("uncertain");
    throw error;
  }
  if (!(await record(value === null ? "refused" : "succeeded"))) return { audited: false };
  return { audited: true, value };
}
