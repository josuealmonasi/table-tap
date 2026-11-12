import { randomUUID } from "node:crypto";
// ============================================================================
// Tickets emailed to the visit card's address (owner's request, 2026-11-11).
// The `queue_ticket_email` trigger puts each paid sale whose card has an
// address in `ticket_email_outbox`; this sends them: one email per card per
// payment (a table's orders paid together are one ticket), with the 80 mm PDF
// attached and the "stop" link. Called with `after()` by every route that
// takes a payment, and by the daily recovery cron for anything left over.
// The receipt is the accounting record; a ticket that cannot be emailed never
// fails the payment that queued it.
// ============================================================================
import { createAdminClient } from "@/lib/supabase/admin";
import { openSittingAt } from "@/lib/table-membership";
import { buildReceipt, receiptModel } from "@/lib/receipt";
import { readOrderReceipt } from "@/lib/receipt-source";
import { ticketPdf } from "@/lib/ticket-pdf";
import { ticketPlace, ticketText } from "@/lib/ticket-place";
import { ticketLoyalty } from "@/lib/ticket-loyalty";
import { sendMail, mailConfigured } from "@/lib/mail";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { DEFAULT_LOCALE, messagesFor, translate } from "@/lib/i18n";

interface OutboxRow { id: string; restaurant_id: string; card_id: string; order_id: string; session_id: string | null; attempts: number; address_key: string | null; batch_key: string | null }
type Outcome = "sent" | "failed" | "unconfigured" | "no_email";

function siteOrigin(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** One email for a group of orders paid together on one card. */
async function sendGroup(rows: OutboxRow[], key: string): Promise<Outcome> {
  const db = createAdminClient();
  const { restaurant_id: restaurantId, card_id: cardId } = rows[0];
  const { data: card } = await db.from("loyalty_cards").select("email, email_unsubscribe")
    .eq("id", cardId).eq("restaurant_id", restaurantId).maybeSingle();
  // Changed or removed since the payment queued it: never the new address.
  if (!card?.email || !card.email_unsubscribe || rows.some(r => r.address_key !== card.email_unsubscribe)) return "no_email";
  if (!mailConfigured()) return "unconfigured";
  const { data: place } = await db.from("restaurants").select("name, timezone").eq("id", restaurantId).single();
  const messages = messagesFor(DEFAULT_LOCALE);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);
  const where = { name: place?.name ?? "TableTap", timeZone: (place?.timezone as string | null) ?? DEFAULT_TIME_ZONE, locale: "es-MX" };
  const source = await readOrderReceipt(db, rows.map(r => r.order_id), true, rows.map(r => r.order_id));
  const receipt = buildReceipt(source.orders, where, t, source.payment);
  const model = receiptModel(source.orders, where, t, source.payment);
  const site = siteOrigin();
  const pdf = await ticketPdf(model, await ticketPlace(db, restaurantId, t), ticketText(t), ticketLoyalty(source, t),
    new URL(`/dashboard/bills?order=${rows[0].order_id}`, site).toString());
  const stop = new URL(`/tickets/stop?t=${card.email_unsubscribe}`, site).toString();
  const footer = t("cardEmail.footer", { restaurant: where.name });
  // The receipt's own footer promises the address is not kept; this one is
  // kept on the card, so that line is replaced, not contradicted (Codex review).
  const kept = (text: string) => text.split(t("receipt.footer")).join("");
  const result = await sendMail({
    to: card.email, fromName: where.name, subject: receipt.subject,
    text: `${kept(receipt.text)}\n\n${footer}\n${t("cardEmail.stopLink")}: ${stop}`,
    html: `${kept(receipt.html)}<p style="margin-top:24px;color:#6E7A74;font-size:12px">${footer} <a href="${stop}">${t("cardEmail.stopLink")}</a></p>`,
    attachments: [{ filename: `ticket-${model.code}.pdf`, content: pdf }],
    headers: { "List-Unsubscribe": `<${stop}>` },
    idempotencyKey: key,
  });
  return result.sent ? "sent" : result.reason;
}

let lastDrain = 0;

/**
 * Send what is waiting. Never throws: it runs after the response has gone.
 * At most once every few seconds per server instance: every payment route
 * calls it, and a burst of requests must not become a burst of claims.
 */
export async function drainTicketEmails(limit = 20): Promise<void> {
  if (Date.now() - lastDrain < 3000) return;
  lastDrain = Date.now();
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("claim_ticket_emails", { p_limit: limit });
    if (error || !data?.length) return;
    const groups = new Map<string, OutboxRow[]>();
    for (const row of data as OutboxRow[]) {
      // A retry keeps the group it failed in; new tickets group by card and sitting.
      const key = row.batch_key ?? `${row.card_id}:${row.session_id ?? row.order_id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const rows of groups.values()) {
      const batch = rows[0].batch_key ?? `ticket-${randomUUID()}`;
      const outcome = await sendGroup(rows, batch).catch((err: unknown) => {
        console.error("ticket email failed", err);
        return "failed" as const;
      });
      // A failure is tried again by a later drain, up to three times.
      const retry = outcome === "failed" && rows.every(r => r.attempts < 3);
      await db.from("ticket_email_outbox")
        .update(retry ? { claimed_at: null, claim: null, batch_key: batch } : { finished_at: new Date().toISOString(), outcome })
        .in("id", rows.map(r => r.id));
    }
  } catch (err) {
    console.error("ticket email drain failed", err);
  }
}

/**
 * The cashier's "don't send it this time" when staff collect a table or a
 * counter order: the unpaid orders this collection can settle — the table's
 * open sitting, in the collection's currency, never a customer account's —
 * are marked before the payment, so the trigger never queues their ticket.
 * Returns an undo for a collection that is then refused, so a refused
 * collection leaves nothing suppressed (Codex review of #622).
 */
export async function skipTicketEmails(restaurantId: string,
  target: { tableId?: string; orderId?: string; orderIds?: string[]; currency?: string }): Promise<() => Promise<void>> {
  // A divided bill with no orders left to settle has nothing to mark; an empty
  // `in` filter must never fall through to a broader write.
  if (target.orderIds && target.orderIds.length === 0) return async () => {};
  const db = createAdminClient();
  let q = db.from("orders").select("id").eq("restaurant_id", restaurantId).eq("paid", false)
    .eq("ticket_email_skip", false).is("account_id", null);
  // A divided bill names its frozen orders: only those close when its last part is paid.
  if (target.orderIds) q = q.in("id", target.orderIds);
  else if (target.orderId) q = q.eq("id", target.orderId);
  else {
    const sitting = await openSittingAt(restaurantId, target.tableId!);
    if (!sitting) return async () => {};
    q = q.eq("table_id", target.tableId!).eq("session_id", sitting);
  }
  if (target.currency) q = q.eq("currency", target.currency);
  const { data, error } = await q;
  if (error) throw new Error(`Could not skip the ticket email: ${error.message}`);
  const ids = (data ?? []).map(o => o.id as string);
  if (!ids.length) return async () => {};
  const { error: markError } = await db.from("orders").update({ ticket_email_skip: true })
    .eq("restaurant_id", restaurantId).in("id", ids);
  if (markError) throw new Error(`Could not skip the ticket email: ${markError.message}`);
  return async () => {
    await db.from("orders").update({ ticket_email_skip: false })
      .eq("restaurant_id", restaurantId).eq("paid", false).is("account_id", null).in("id", ids);
  };
}
