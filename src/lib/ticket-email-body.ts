// ============================================================================
// The ticket email's body, rendered once per batch and kept on its outbox
// rows until the batch finishes. A retry sends the identical body under the
// same idempotency key: the provider then answers with the email it already
// sent, where a body rebuilt with newer loyalty progress or a new PDF date is
// a changed payload it refuses (background review, finding 12).
// ============================================================================
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Mail } from "@/lib/mail";
import { buildReceipt, receiptModel } from "@/lib/receipt";
import { readOrderReceipt } from "@/lib/receipt-source";
import { ticketPdf } from "@/lib/ticket-pdf";
import { ticketPlace, ticketText } from "@/lib/ticket-place";
import { ticketLoyalty } from "@/lib/ticket-loyalty";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { DEFAULT_LOCALE, messagesFor, translate } from "@/lib/i18n";
import { ticketMail as cardTicketText } from "@/lib/ticket-mail";

/** Everything sent but the recipient, which is read from the card each time. */
export interface StoredTicketMail {
  fromName: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  /** PDF content in base64: the body is stored as JSON. */
  attachments: { filename: string; content: string }[];
}

function siteOrigin(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Render one group's email: the receipt, the 80 mm PDF and the stop link. */
export async function renderTicketMail(
  db: ReturnType<typeof createAdminClient>, restaurantId: string, orderIds: string[], stopSecret: string,
): Promise<StoredTicketMail> {
  const { data: place } = await db.from("restaurants").select("name, timezone").eq("id", restaurantId).single();
  const messages = messagesFor(DEFAULT_LOCALE);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);
  const where = { name: place?.name ?? "TableTap", timeZone: (place?.timezone as string | null) ?? DEFAULT_TIME_ZONE, locale: "es-MX" };
  const source = await readOrderReceipt(db, orderIds, true, orderIds);
  const receipt = buildReceipt(source.orders, where, t, source.payment);
  const model = receiptModel(source.orders, where, t, source.payment);
  const site = siteOrigin();
  const pdf = await ticketPdf(model, await ticketPlace(db, restaurantId, t), ticketText(t), ticketLoyalty(source, t),
    new URL(`/dashboard/bills?order=${orderIds[0]}`, site).toString());
  const stop = new URL(`/tickets/stop?t=${stopSecret}`, site).toString();
  const footer = t("cardEmail.footer", { restaurant: where.name });
  // The receipt's own footer promises the address is not kept; this one is
  // kept on the card, so that line is replaced, not contradicted (Codex review).
  const mail = cardTicketText(receipt, { receiptFooter: t("receipt.footer"), footer, stopLabel: t("cardEmail.stopLink"), stop });
  return {
    fromName: where.name, subject: receipt.subject,
    ...mail,
    attachments: [{ filename: `ticket-${model.code}.pdf`, content: Buffer.from(pdf).toString("base64") }],
    headers: { "List-Unsubscribe": `<${stop}>` },
  };
}

/** The stored body as a mail to send. */
export function ticketMail(body: StoredTicketMail, to: string, idempotencyKey: string): Mail {
  return { ...body, to, idempotencyKey,
    attachments: body.attachments.map(a => ({ filename: a.filename, content: Buffer.from(a.content, "base64") })) };
}
