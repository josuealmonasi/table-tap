import { NextResponse } from "next/server";
import { drainTicketEmailQueue } from "@/lib/ticket-email";
import { cronAuthorized } from "@/lib/cron-auth";
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

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Ticket emails left waiting since the last payment request drained them:
  // claimed until the queue is empty or the budget runs out (Codex review of
  // #622). Never throws; it stops between groups and releases what it claimed.
  const tickets = drainTicketEmailQueue(20, 50, Date.now() + TICKET_DRAIN_MS);
  const jobs: Record<string, RecoveryJob> = { stock: recoverStock, refunds: recoverRefunds, fees: recoverFees, subscriptions: recoverSubscriptions, disputes: recoverDisputes };
  const results: Record<string, RecoveryResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    // Each job gets its own deadline even when the previous provider failed.
    results[name] = await isolateJob(name, () => job(recoveryContext()));
    console.info("Scheduled recovery", { job: name, ...results[name] });
  }
  await tickets;
  return NextResponse.json({ jobs: results }, { headers: { "Cache-Control": "no-store" } });
}
