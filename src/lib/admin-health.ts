import { createAdminClient } from "@/lib/supabase/admin";
import type { PlatformHealth } from "@/lib/admin-health-rules";

export type { PlatformHealth };

const WEEK = 7 * 86_400_000;

/**
 * Each of these failed silently once: the scheduler not running, tickets
 * dropped for missing mail settings, a notice that never went out, a
 * restaurant whose diners could not pay by card. One count each; the detail
 * lives where it always did (logs, the outbox, the restaurant's own screens).
 */
export async function readPlatformHealth(now = Date.now()): Promise<PlatformHealth> {
  const db = createAdminClient();
  const since = new Date(now - WEEK).toISOString();
  const [run, tickets, notices, cards] = await Promise.all([
    db.from("recovery_runs").select("at").eq("source", "database").eq("ok", true).order("at", { ascending: false }).limit(1).maybeSingle(),
    db.from("ticket_email_outbox").select("id", { count: "exact", head: true }).in("outcome", ["failed", "unconfigured"]).gte("finished_at", since),
    db.from("plan_price_notices").select("change_id", { count: "exact", head: true }).is("sent_at", null).gt("attempts", 0),
    db.from("restaurants").select("id", { count: "exact", head: true }).or("stripe_account_id.is.null,stripe_charges_enabled.is.false"),
  ]);
  for (const [name, r] of [["scheduler", run], ["tickets", tickets], ["notices", notices], ["cards", cards]] as const) {
    if (r.error) throw new Error(`Health read failed (${name}): ${r.error.message}`);
  }
  return {
    schedulerLastRun: (run.data as { at: string } | null)?.at ?? null,
    failedTickets7d: tickets.count ?? 0,
    stuckPriceNotices: notices.count ?? 0,
    noCards: cards.count ?? 0,
  };
}
