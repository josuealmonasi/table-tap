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
import { recoverPriceNotices } from "@/lib/recovery/price-notices";
import { recoverPriceMoves, recoverPriceCatalogue } from "@/lib/recovery/price-moves";
import { recoverPriceRecipients } from "@/lib/recovery/price-recipients";
import { recoverTrialReminders } from "@/lib/recovery/trial-reminders";
import { recoverDailyDigests } from "@/lib/recovery/daily-digest";
import { signedRecoveryAuthorized } from "@/lib/recovery/signed-auth";
import { schedulerHealth } from "@/lib/recovery/health.mjs";
import { purgeAccounting } from "@/lib/recovery/accounting-purge";

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
 * five-minute pg_cron job (a one-time signature), and GitHub's best-effort
 * backup schedule (a one-time OIDC token). Vercel uses `Bearer CRON_SECRET`.
 * Everything else is refused.
 */
async function recover(request: Request) {
  const scheduled = request.headers.has("x-recover-signature") && await signedRecoveryAuthorized(request, createAdminClient());
  if (!scheduled && !cronAuthorized(request)) {
    const github = await githubCronAuthorized(request);
    if (github === "unavailable") return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
    if (github !== "authorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = createAdminClient();
  // Ticket emails left waiting since the last payment request drained them:
  // claimed until the queue is empty or the budget runs out (Codex review of
  // #622). Never throws; it stops between groups and releases what it claimed.
  const tickets = drainTickets().catch(() => null);
  // More sequential budgets would exceed the route limit.
  // Recipients first (anyone Stripe bills on the tier), then their notices.
  const priceRecipients = isolateJob("price_recipients", () => recoverPriceRecipients(recoveryContext()));
  const priceNotices = priceRecipients.then(() => isolateJob("price_notices", () => recoverPriceNotices(recoveryContext())));
  // Moves run after notices are sent (they only touch notified subscribers),
  // and the catalogue change once its effective date has arrived.
  const priceMoves = priceNotices.then(() => isolateJob("price_moves", () => recoverPriceMoves(recoveryContext())));
  const priceCatalogue = isolateJob("price_catalogue", () => recoverPriceCatalogue(recoveryContext()));
  const accounting = isolateJob("accounting", () => purgeAccounting(recoveryContext()));
  const digest = isolateJob("daily_digest", () => recoverDailyDigests(recoveryContext()));
  const jobs: Record<string, RecoveryJob> = { stock: recoverStock, refunds: recoverRefunds, fees: recoverFees, subscriptions: recoverSubscriptions, disputes: recoverDisputes,
    trial_reminders: recoverTrialReminders };
  const results: Record<string, RecoveryResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    // Each job gets its own deadline even when the previous provider failed.
    results[name] = await isolateJob(name, () => job(recoveryContext()));
    console.info("Scheduled recovery", { job: name, ...results[name] });
  }
  results.price_recipients = await priceRecipients;
  console.info("Scheduled recovery", { job: "price_recipients", ...results.price_recipients });
  results.price_notices = await priceNotices;
  console.info("Scheduled recovery", { job: "price_notices", ...results.price_notices });
  results.price_moves = await priceMoves;
  console.info("Scheduled recovery", { job: "price_moves", ...results.price_moves });
  results.price_catalogue = await priceCatalogue;
  console.info("Scheduled recovery", { job: "price_catalogue", ...results.price_catalogue });
  // The purge counts toward a healthy run like every other job.
  results.accounting = await accounting;
  console.info("Scheduled recovery", { job: "accounting", ...results.accounting });
  results.daily_digest = await digest;
  console.info("Scheduled recovery", { job: "daily_digest", ...results.daily_digest });
  const drained = await tickets;
  console.info("Scheduled recovery", { job: "tickets", ...drained });
  const ok = Object.values(results).every(r => r.failed === 0 && !r.observation_failed && r.pending !== null) &&
    drained !== null && drained.failed === 0 && drained.expired === 0 && drained.errors === 0;
  if (scheduled && ok) {
    const { error } = await db.from("recovery_runs").insert({ source: "database", ok: true });
    if (error) console.error("Could not record scheduled recovery", error.message);
    await db.from("recovery_runs").delete().lt("at", new Date(Date.now() - 7 * 86_400_000).toISOString());
  }
  let health = schedulerHealth(false, null, false);
  if (process.env.VERCEL_ENV === "production") {
    const { data, error } = await db.from("recovery_runs").select("at").eq("source", "database").eq("ok", true)
      .order("at", { ascending: false }).limit(1).maybeSingle();
    health = schedulerHealth(true, data?.at ?? null, Boolean(error));
  }
  return NextResponse.json({ jobs: results, tickets: drained, scheduler: health }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = recover;
/** pg_net's `net.http_post` from the database's schedule. */
export const POST = recover;
