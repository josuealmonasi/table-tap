import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { kitchenTicket } from "@/lib/ticket";
import { messagesFor, translate } from "@/lib/i18n";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The kitchen printer's endpoint — Star CloudPRNT.
 *
 * The printer polls this URL over outbound HTTPS: POST asks "anything for
 * me?", GET collects it, DELETE confirms it came out. That direction matters —
 * nothing reaches into the restaurant's network, so no port forwarding, no
 * static IP, and no agent installed on somebody's Windows machine.
 *
 * SECURITY. A printer cannot log in, hold a session, or send a header we
 * choose. The URL it is configured with is the whole credential, which sets
 * the rules the rest of this file follows:
 *
 *   - the token is 32 random bytes, compared in constant time, and rotatable
 *     from the settings screen the moment anybody doubts it;
 *   - it names exactly one restaurant, and every query below is filtered by
 *     the id that token resolved to — never by anything in the request;
 *   - what it can obtain is a kitchen ticket: dishes, modifiers, and the name
 *     a walk-in gave. No totals, no card, no address, no diner account;
 *   - it is off until a restaurant turns printing on, so the surface does not
 *     exist for anyone who has not asked for it;
 *   - and it is rate limited per token, because an unauthenticated URL that
 *     runs a query is worth limiting whether or not the token is right.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Compare in constant time.
 *
 * Belt and braces, and worth being honest about which: the row was already
 * found with `.eq("print_token", …)`, so Postgres matched it exactly and this
 * can only ever agree. It is here so that a later refactor which loosens that
 * lookup — a prefix, a join, a cache — does not quietly turn the comparison
 * into a byte-by-byte one that answers faster the closer a guess gets.
 *
 * The length check returns early because `timingSafeEqual` throws on unequal
 * lengths. That does leak the length, which is fine: every token this issues
 * is the same 43 characters, so the length tells an attacker nothing they
 * could not read off the format.
 */
function tokenMatches(given: string, actual: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface Printer {
  restaurantId: string;
  name: string;
  timeZone: string;
}

/**
 * Resolve the token to the restaurant that owns it, or nothing.
 *
 * The lookup is by token, so an attacker cannot ask about a restaurant they
 * name — they can only present a secret and be told nothing if it is wrong.
 */
async function printerFor(req: NextRequest, token: string): Promise<Printer | null> {
  if (!token || token.length < 32 || token.length > 128) return null;
  // Bucketed by CALLER, not by token. Keying the limit on the token would give
  // somebody guessing a fresh bucket with every guess, which is no limit at
  // all. A real printer polls from one address every few seconds; 120 a minute
  // is generous for that and useless for a search.
  if (await isRateLimited(`cloudprnt:${clientIp(req)}`, 120, 60)) return null;

  const db = createAdminClient();
  const { data } = await db
    .from("restaurants")
    .select("id, name, timezone, print_token")
    .eq("print_token", token)
    .maybeSingle();
  if (!data?.print_token) return null;
  if (!tokenMatches(token, data.print_token as string)) return null;

  return {
    restaurantId: data.id as string,
    name: (data.name as string) ?? "",
    timeZone: (data.timezone as string) ?? DEFAULT_TIME_ZONE,
  };
}

/** The oldest ticket this restaurant has not printed yet. */
async function pendingJob(restaurantId: string) {
  const db = createAdminClient();
  const { data } = await db
    .from("print_jobs")
    .select("id, order_id")
    .eq("restaurant_id", restaurantId)
    .is("printed_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * "Nothing waiting."
 *
 * The answer a real printer gets on a quiet counter, and — byte for byte — the
 * answer a wrong address gets. Written once because it was briefly written
 * twice, and the two differed: the wrong-address reply was missing
 * `mediaTypes` and `deleteMethod`, which turned a guess into a guess somebody
 * could confirm. The token is 32 random bytes, so nobody was going to guess it
 * — but a reply that says "not that one" is a reply that helps, and this one
 * should help nobody.
 */
// Plain text is the one format every CloudPRNT printer renders without a
// conversion step, and the one a test can assert on.
const IDLE = { jobReady: false, mediaTypes: ["text/plain"], deleteMethod: "DELETE" };

// POST — the printer's heartbeat, every few seconds. Answering `jobReady` is
// what makes it come back with a GET.
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const printer = await printerFor(req, (await ctx.params).token);
  if (!printer) return NextResponse.json(IDLE);

  const job = await pendingJob(printer.restaurantId);
  if (!job) return NextResponse.json(IDLE);

  return NextResponse.json({ ...IDLE, jobReady: true, jobToken: job.id as string });
}

// GET — hand over the ticket. Repeatable on purpose: the protocol says a GET
// has no side effects, so a printer that jams and asks again gets the same
// paper rather than the next order's.
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const printer = await printerFor(req, (await ctx.params).token);
  if (!printer) return new NextResponse(null, { status: 404 });

  const job = await pendingJob(printer.restaurantId);
  if (!job) return new NextResponse(null, { status: 404 });

  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("id, items, note, table_label, customer_name, created_at")
    .eq("id", job.order_id as string)
    // Belt and braces: the job already named this restaurant, and the order
    // has to agree before a single character is printed.
    .eq("restaurant_id", printer.restaurantId)
    .maybeSingle();
  if (!order) return new NextResponse(null, { status: 404 });

  await db
    .from("print_jobs")
    .update({ claimed_at: new Date().toISOString() })
    .eq("id", job.id as string)
    .eq("restaurant_id", printer.restaurantId);

  const messages = messagesFor("es");
  const body = kitchenTicket(
    {
      id: order.id as string,
      items: order.items as never,
      note: order.note as string | null,
      table_label: order.table_label as string | null,
      customer_name: order.customer_name as string | null,
      created_at: order.created_at as string,
    },
    { name: printer.name, timeZone: printer.timeZone },
    (key, vars) => translate(messages, key, vars),
  );

  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// DELETE — it came out of the printer. Only then is the job closed.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const printer = await printerFor(req, (await ctx.params).token);
  if (!printer) return new NextResponse(null, { status: 404 });

  // Close the job the printer was actually handed. The protocol echoes the
  // `jobToken` we sent, and using it matters the moment a restaurant points
  // two printers at one URL: closing "whatever is oldest" would let the
  // counter printer's confirmation throw away the kitchen's unprinted ticket.
  // Shape-checked before it reaches a query: an id column asked for something
  // that is not a uuid is a database error, not a 200 with nothing done.
  const echoed = req.nextUrl.searchParams.get("token");
  const jobId = echoed && UUID.test(echoed) ? echoed : null;
  const job = jobId ? { id: jobId } : await pendingJob(printer.restaurantId);
  if (job) {
    await createAdminClient()
      .from("print_jobs")
      .update({ printed_at: new Date().toISOString() })
      .eq("id", job.id as string)
      // Scoped by the restaurant the TOKEN resolved to, so an echoed id from
      // somewhere else closes nothing.
      .eq("restaurant_id", printer.restaurantId)
      .is("printed_at", null);
  }
  return new NextResponse(null, { status: 200 });
}
