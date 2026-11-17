import { NextResponse } from "next/server";
import { drainTicketEmailQueue, type TicketDrain } from "@/lib/ticket-email";
import { cronAuthorized } from "@/lib/cron-auth";
import { githubCronAuthorized } from "@/lib/github-cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { recoveryContext } from "@/lib/recovery/context";
import { isolateJob, type RecoveryJob, type RecoveryResult } from "@/lib/recovery/job";
import { recoverStock } from "@/lib/recovery/stock";
import { recoverFees } from "@/lib/recovery/fees";
import { recoverRefunds } from "@/lib/recovery/refunds";
import { recoverSubscriptions } from "@/lib/recovery/subscriptions";
import { recoverDisputes } from "@/lib/recovery/disputes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
/** The ticket drain's own budget, run alongside the jobs (which take at most
 * 5 × 10 s): it once ran in `after()` and got only what the jobs left of 60 s. */
const TICKET_DRAIN_MS = 40_000;

/** The drain's counts, plus tickets the claim expired during this run: a
 * ticket a day old is finished as `expired` inside `claim_ticket_emails`. */
async function drainTickets(): Promise<TicketDrain & { expired: number }> {
  const started = new Date().toISOString();
  const drain = await drainTicketEmailQueue(20, 50, Date.now() + TICKET_DRAIN_MS);
  const { count, error } = await createAdminClient().from("ticket_email_outbox")
    .select("id", { count: "exact", head: true }).eq("outcome", "expired").gte("finished_at", started);
  if (error) return { ...drain, expired: 0, errors: drain.errors + 1 };
  return { ...drain, expired: count ?? 0 };
}

/**
 * Callers, all checked here: Vercel's daily cron and the database's
 * five-minute pg_cron job (both `Bearer CRON_SECRET`, compared in constant
 * time), and GitHub's best-effort backup schedule (a signed OIDC identity).
 * Everything else is refused.
 */
async function recover(request: Request) {
  if (!cronAuthorized(request) && !await githubCronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Ticket emails left waiting since the last payment request drained them:
  // claimed until the queue is empty or the budget runs out (Codex review of
  // #622). Never throws; it stops between groups and releases what it claimed.
  const tickets = drainTickets().catch(() => null);
  const jobs: Record<string, RecoveryJob> = { stock: recoverStock, refunds: recoverRefunds, fees: recoverFees, subscriptions: recoverSubscriptions, disputes: recoverDisputes };
  const results: Record<string, RecoveryResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    // Each job gets its own deadline even when the previous provider failed.
    results[name] = await isolateJob(name, () => job(recoveryContext()));
    console.info("Scheduled recovery", { job: name, ...results[name] });
  }
  const drained = await tickets;
  console.info("Scheduled recovery", { job: "tickets", ...drained });
  return NextResponse.json({ jobs: results, tickets: drained }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = recover;
/** pg_net's `net.http_post` from the database's schedule. */
export const POST = recover;
