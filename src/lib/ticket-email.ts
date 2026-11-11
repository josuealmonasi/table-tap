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
import { buildReceipt, receiptModel } from "@/lib/receipt";
import { readOrderReceipt } from "@/lib/receipt-source";
import { ticketPdf } from "@/lib/ticket-pdf";
import { ticketPlace, ticketText } from "@/lib/ticket-place";
import { ticketLoyalty } from "@/lib/ticket-loyalty";
import { sendMail, mailConfigured } from "@/lib/mail";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { DEFAULT_LOCALE, messagesFor, translate } from "@/lib/i18n";

interface OutboxRow { id: string; restaurant_id: string; card_id: string; order_id: string; session_id: string | null; attempts: number }
type Outcome = "sent" | "failed" | "unconfigured" | "no_email";

function siteOrigin(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** One email for a group of orders paid together on one card. */
async function sendGroup(rows: OutboxRow[]): Promise<Outcome> {
  const db = createAdminClient();
  const { restaurant_id: restaurantId, card_id: cardId } = rows[0];
  const { data: card } = await db.from("loyalty_cards").select("email, email_unsubscribe")
    .eq("id", cardId).eq("restaurant_id", restaurantId).maybeSingle();
  if (!card?.email || !card.email_unsubscribe) return "no_email";
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
  const result = await sendMail({
    to: card.email, fromName: where.name, subject: receipt.subject,
    text: `${receipt.text}\n\n${footer}\n${t("cardEmail.stopLink")}: ${stop}`,
    html: `${receipt.html}<p style="margin-top:24px;color:#6E7A74;font-size:12px">${footer} <a href="${stop}">${t("cardEmail.stopLink")}</a></p>`,
    attachments: [{ filename: `ticket-${model.code}.pdf`, content: pdf }],
    headers: { "List-Unsubscribe": `<${stop}>` },
    idempotencyKey: `ticket-${rows.map(r => r.id).sort()[0]}`,
  });
  return result.sent ? "sent" : result.reason;
}

/** Send what is waiting. Never throws: it runs after the response has gone. */
export async function drainTicketEmails(limit = 20): Promise<void> {
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("claim_ticket_emails", { p_limit: limit });
    if (error || !data?.length) return;
    const groups = new Map<string, OutboxRow[]>();
    for (const row of data as OutboxRow[]) {
      const key = `${row.card_id}:${row.session_id ?? row.order_id}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const rows of groups.values()) {
      const outcome = await sendGroup(rows).catch((err: unknown) => {
        console.error("ticket email failed", err);
        return "failed" as const;
      });
      // A failure is tried again by a later drain, up to three times.
      const retry = outcome === "failed" && rows.every(r => r.attempts < 3);
      await db.from("ticket_email_outbox")
        .update(retry ? { claimed_at: null, claim: null } : { finished_at: new Date().toISOString(), outcome })
        .in("id", rows.map(r => r.id));
    }
  } catch (err) {
    console.error("ticket email drain failed", err);
  }
}

/**
 * The cashier's "don't send it this time" when staff collect a table or a counter order: the
 * unpaid orders about to be collected are marked before the payment, so the
 * trigger never queues their ticket. Scoped to the staff member's restaurant.
 */
export async function skipTicketEmails(restaurantId: string, target: { tableId?: string; orderId?: string }): Promise<void> {
  let q = createAdminClient().from("orders").update({ ticket_email_skip: true })
    // A customer account's orders are never the table's (they are paid on the account).
    .eq("restaurant_id", restaurantId).eq("paid", false).is("account_id", null);
  q = target.orderId ? q.eq("id", target.orderId) : q.eq("table_id", target.tableId!);
  const { error } = await q;
  if (error) throw new Error(`Could not skip the ticket email: ${error.message}`);
}
