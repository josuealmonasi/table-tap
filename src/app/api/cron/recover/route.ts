import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { recoveryContext } from "@/lib/recovery/context";
import { isolateJob, type RecoveryJob, type RecoveryResult } from "@/lib/recovery/job";
import { recoverStock } from "@/lib/recovery/stock";
import { recoverFees } from "@/lib/recovery/fees";
import { recoverRefunds } from "@/lib/recovery/refunds";
import { recoverSubscriptions } from "@/lib/recovery/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobs: Record<string, RecoveryJob> = { stock: recoverStock, refunds: recoverRefunds, fees: recoverFees, subscriptions: recoverSubscriptions };
  const results: Record<string, RecoveryResult> = {};
  for (const [name, job] of Object.entries(jobs)) {
    // Each job gets its own deadline even when the previous provider failed.
    results[name] = await isolateJob(name, () => job(recoveryContext()));
    console.info("Scheduled recovery", { job: name, ...results[name] });
  }
  return NextResponse.json({ jobs: results }, { headers: { "Cache-Control": "no-store" } });
}
