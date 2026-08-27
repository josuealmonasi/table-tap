import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateLimited } from "@/lib/rate-limit";
import { TOKEN_SHAPE } from "@/lib/printing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CloudPRNT — la impresora nos habla a nosotros.
 *
 * A browser cannot open a socket or speak classic Bluetooth, so the page can
 * never send anything to a thermal printer. These invert that: the device sits
 * on the restaurant's wifi and polls us over HTTPS. Nothing runs on site, there
 * is no bridge, and we never need its IP.
 *
 *   POST   anything for me?      → { jobReady }
 *   GET    give me the job       → the ticket text
 *   DELETE printed it            → closed
 *
 * The token in the URL is the whole credential, because a printer cannot sign
 * in. That is why it buys nothing else: it only sees ITS printer's jobs and can
 * only close them. See docs/printing.md.
 */

/** How long a claimed ticket may sit before it goes back on the queue. */
const CLAIM_MINUTES = 2;

async function printerFor(token: string) {
  if (!TOKEN_SHAPE.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("printers")
    .select("id, restaurant_id, active")
    .eq("token", token)
    .maybeSingle();
  return data?.active ? data : null;
}

/** Any work? And, while we are here, how the printer says it is doing. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // By token, not by IP: every printer in one venue shares an address.
  if (await isRateLimited(`print:${token}`, 120, 60)) {
    return NextResponse.json({ jobReady: false }, { status: 429 });
  }
  const printer = await printerFor(token);
  if (!printer) return NextResponse.json({ jobReady: false }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    printerMAC?: string;
    status?: string;
    statusCode?: string;
  };
  const db = createAdminClient();

  // What it reports about itself: out of paper, lid open, jammed. Kept so the
  // owner can see it in Settings instead of guessing why nothing comes out.
  const trouble = body.statusCode && body.statusCode !== "200 OK" ? body.statusCode : null;
  await db
    .from("printers")
    .update({ last_seen_at: new Date().toISOString(), mac: body.printerMAC ?? null, last_error: trouble })
    .eq("id", printer.id);

  // Anything claimed and not printed goes back on the queue before we look.
  await db.rpc("requeue_stale_print_jobs", { p_minutes: CLAIM_MINUTES });

  const { data: job } = await db
    .from("print_jobs")
    .select("id")
    .eq("printer_id", printer.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    jobReady: Boolean(job),
    mediaTypes: ["text/plain"],
    jobToken: job?.id ?? "",
  });
}

/** Give me the ticket. Marked claimed on handing it over, not before. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const printer = await printerFor(token);
  if (!printer) return new NextResponse("", { status: 404 });

  const db = createAdminClient();
  const { data: job } = await db
    .from("print_jobs")
    .select("id, body, attempts")
    .eq("printer_id", printer.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!job) return new NextResponse("", { status: 200 });

  await db
    .from("print_jobs")
    .update({ status: "claimed", claimed_at: new Date().toISOString(), attempts: job.attempts + 1 })
    .eq("id", job.id);

  return new NextResponse(job.body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * It came out.
 *
 * If this acknowledgement is lost — the wifi drops between the paper and the
 * receipt — the ticket returns to the queue and prints again. A spare sheet is
 * cheap; a missing one costs a table its food.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const printer = await printerFor(token);
  if (!printer) return new NextResponse("", { status: 404 });

  const db = createAdminClient();
  await db
    .from("print_jobs")
    .update({ status: "printed", printed_at: new Date().toISOString() })
    .eq("printer_id", printer.id)
    .eq("status", "claimed");

  return new NextResponse("", { status: 200 });
}
