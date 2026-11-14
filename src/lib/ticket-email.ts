import { createHash } from "node:crypto";
// ============================================================================
// Tickets emailed to the visit card's address (owner's request, 2026-11-11).
// The `queue_ticket_email` trigger puts each paid sale whose card has an
// address in `ticket_email_outbox`; this sends them: one email per card per
// payment (a table's orders paid together are one ticket), with the 80 mm PDF
// attached and the "stop" link. Called with `after()` by every route that
// takes a payment, and by the five-minute recovery cron for anything left over.
// The receipt is the accounting record; a ticket that cannot be emailed never
// fails the payment that queued it.
// ============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMail, mailConfigured } from "@/lib/mail";
import { renderTicketMail, ticketMail, type StoredTicketMail } from "@/lib/ticket-email-body";
import { outboxPatch, ticketOutcome, type TicketOutcome } from "@/lib/ticket-email-retry";

interface OutboxRow {
  id: string; restaurant_id: string; card_id: string; order_id: string; session_id: string | null; attempts: number;
  address_key: string | null; batch_key: string | null; claim: string; mail_body?: StoredTicketMail | null;
}
type Db = ReturnType<typeof createAdminClient>;

/** One email for a group of orders paid together on one card; "lost" when
 * this sender no longer owns every row of the group. */
async function sendGroup(db: Db, rows: OutboxRow[]): Promise<TicketOutcome | "lost"> {
  const { restaurant_id: restaurantId, card_id: cardId, claim } = rows[0];
  const ids = rows.map(r => r.id);
  const { data: card, error: cardError } = await db.from("loyalty_cards").select("email, email_unsubscribe")
    .eq("id", cardId).eq("restaurant_id", restaurantId).maybeSingle();
  // An unread address is not a removed address: keep the ticket for a retry.
  if (cardError) throw new Error(cardError.message);
  // Changed or removed since the payment queued it: never the new address.
  if (!card?.email || !card.email_unsubscribe || rows.some(r => r.address_key !== card.email_unsubscribe)) return { outcome: "no_email" };
  if (!mailConfigured()) return { outcome: "unconfigured" };
  const key = rows[0].batch_key ?? batchKeyFor(ids);
  let body = rows.find(r => r.mail_body)?.mail_body ?? null;
  // The group's key and body are written before the provider is called: a
  // sender that dies after the email went out leaves both behind, and the
  // retry sends the same body with the same key, so the provider answers
  // with the email it already sent.
  if (!body || !rows[0].batch_key) {
    body ??= await renderTicketMail(db, restaurantId, rows.map(r => r.order_id), card.email_unsubscribe);
    let write = db.from("ticket_email_outbox").update({ ...(rows[0].batch_key ? {} : { batch_key: key }), mail_body: body })
      .eq("restaurant_id", restaurantId).eq("claim", claim);
    if (!rows[0].batch_key) write = write.is("batch_key", null);
    const { data: kept, error } = await write.in("id", ids).select("id");
    // Not recorded on every row this sender still owns, not sent: a lease
    // that lapsed belongs to whoever claimed it since, and a later drain
    // sends the group whole (Codex review of the delta, 2026-11-12).
    if (error || kept?.length !== ids.length) return "lost";
  }
  return ticketOutcome(await sendMail(ticketMail(body, card.email, key)));
}

let lastDrain = 0;
let waiting: Promise<void> | null = null;

/**
 * Send what is waiting. Never throws: it runs after the response has gone.
 * At most once every few seconds per server instance: every payment route
 * calls it, and a burst of requests must not become a burst of claims. A
 * request inside that window is not dropped: it waits the window out and
 * drains then, and every request waiting meanwhile shares that one drain.
 */
export async function drainTicketEmails(limit = 20): Promise<void> {
  const wait = lastDrain + 3000 - Date.now();
  if (wait > 0) {
    waiting ??= new Promise<void>(done => setTimeout(done, wait)).then(() => {
      waiting = null;
      return drainTicketEmails(limit);
    });
    return waiting;
  }
  lastDrain = Date.now();
  await drainOnce(limit);
}

/**
 * The recovery cron: claim and send until nothing is left, so a backlog larger
 * than one claim is not left to expire before the next run (Codex review of
 * #622). Bounded by rounds and by its own deadline, and it stops once a claim
 * brings back only rows it has already tried.
 */
export async function drainTicketEmailQueue(rounds = 20, limit = 50, deadline = Infinity): Promise<void> {
  const seen = new Set<string>();
  for (let round = 0; round < rounds && Date.now() < deadline; round++) {
    const ids = await drainOnce(limit, deadline);
    const fresh = ids.filter(id => !seen.has(id));
    ids.forEach(id => seen.add(id));
    if (ids.length < limit || !fresh.length) return;
  }
}

/** The idempotency key of a new group: the same rows always make the same key. */
export function batchKeyFor(ids: string[]): string {
  return `ticket-${createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 32)}`;
}

/** One claim of up to `limit` rows, sent; returns the ids it claimed. Groups
 * left when the deadline passes are released for the next drain. */
async function drainOnce(limit: number, deadline = Infinity): Promise<string[]> {
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("claim_ticket_emails", { p_limit: limit });
    if (error || !data?.length) return [];
    const groups = new Map<string, OutboxRow[]>();
    for (const row of data as OutboxRow[]) {
      // A retry keeps the group it was first sent in; new tickets group by
      // card, sitting and address generation, so a ticket queued for an old
      // address never takes a current one down with it.
      const key = row.batch_key ?? `${row.card_id}:${row.session_id ?? row.order_id}:${row.address_key}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const rows of groups.values()) {
      const ids = rows.map(r => r.id);
      const writeRows = (patch: Record<string, unknown>) => db.from("ticket_email_outbox").update(patch)
        .eq("restaurant_id", rows[0].restaurant_id).eq("claim", rows[0].claim).in("id", ids);
      if (Date.now() >= deadline) {
        await writeRows({ claimed_at: null, claim: null });
        continue;
      }
      const result = await sendGroup(db, rows).catch((err: unknown): TicketOutcome => {
        console.error("ticket email failed", err);
        return { outcome: "failed", retryable: true, reason: `error: ${err instanceof Error ? err.message : String(err)}` };
      });
      if (result === "lost") continue;
      await writeRows(outboxPatch(result, Math.max(...rows.map(r => r.attempts))));
    }
    return (data as OutboxRow[]).map(r => r.id);
  } catch (err) {
    console.error("ticket email drain failed", err);
    return [];
  }
}


/**
 * The cashier's "don't send it this time" when staff collect a table or a
 * counter order: the unpaid orders this collection can settle are marked
 * before the payment, so the trigger never queues their ticket. For a table
 * that is exactly what the money writer settles: every outstanding order of
 * the table in the collection's currency, older sittings included, never a
 * customer account's (Codex review of #622). `skip` false clears the mark: a
 * divided bill's latest collection decides for the orders it closes.
 * Returns an undo for a collection that is then refused, so a refused
 * collection leaves the marks as they were.
 */
export async function skipTicketEmails(restaurantId: string,
  target: { tableId?: string; orderId?: string; orderIds?: string[]; currency?: string }, skip = true): Promise<() => Promise<void>> {
  // A divided bill with no orders left to settle has nothing to mark; an empty
  // `in` filter must never fall through to a broader write.
  if (target.orderIds && target.orderIds.length === 0) return async () => {};
  const db = createAdminClient();
  let q = db.from("orders").select("id").eq("restaurant_id", restaurantId).eq("paid", false)
    .eq("ticket_email_skip", !skip).is("account_id", null);
  // A divided bill names its frozen orders: only those close when its last part is paid.
  if (target.orderIds) q = q.in("id", target.orderIds);
  else if (target.orderId) q = q.eq("id", target.orderId);
  else {
    q = q.eq("table_id", target.tableId!).eq("written_off", false)
      .neq("status", "pending_payment").neq("status", "cancelled");
  }
  if (target.currency) q = q.eq("currency", target.currency);
  const { data, error } = await q;
  if (error) throw new Error(`Could not skip the ticket email: ${error.message}`);
  const ids = (data ?? []).map(o => o.id as string);
  if (!ids.length) return async () => {};
  const { error: markError } = await db.from("orders").update({ ticket_email_skip: skip })
    .eq("restaurant_id", restaurantId).in("id", ids);
  if (markError) throw new Error(`Could not skip the ticket email: ${markError.message}`);
  return async () => {
    await db.from("orders").update({ ticket_email_skip: !skip })
      .eq("restaurant_id", restaurantId).eq("paid", false).is("account_id", null).in("id", ids);
  };
}
