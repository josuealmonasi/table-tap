import type { createAdminClient } from "@/lib/supabase/admin";
import { buildReceipt } from "@/lib/receipt";
import { mailConfigured, sendMail } from "@/lib/mail";
import { isValidEmail, normalizeEmail } from "@/lib/email";
import { messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { dateLocale } from "@/lib/format";
import type { OrderLineItem } from "@/lib/types";

export interface SaleReceiptInput {
  db: ReturnType<typeof createAdminClient>;
  order: { id: string };
  verified: OrderLineItem[];
  pricing: {
    subtotal: number;
    serviceFee: number;
    tip: number;
    discount: number;
    total: number;
  };
  restaurant: { name?: string; currency: unknown; timezone: unknown };
  method: "cash" | "card" | "account";
  body: { email?: unknown; noReceipt?: unknown };
}

/** The ticket for a sale rung at the till: emailed, handed back to print, or nothing. */
export async function saleReceipt({
  db,
  order,
  verified,
  pricing,
  restaurant,
  method,
  body,
}: SaleReceiptInput): Promise<{
  receipt: "sent" | "failed" | null;
  receiptHtml: string | null;
}> {
  // "Do you want your receipt sent, or printed?" — whichever they answer, this
  // handles it. The address is used for this one message and never written
  // down: an order row is kept for years as the restaurant's accounting
  // record, and an address stored beside one would outlive its purpose by
  // about that much. `receipt_sent_at` is all that stays, which answers "did
  // this get a receipt?" without keeping anybody's address. The privacy notice
  // makes that promise; this is the code that keeps it.
  let receipt: "sent" | "failed" | null = null;
  /** The ticket to print, when nobody asked for it by email. */
  let receiptHtml: string | null = null;
  const address = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const wantsMail = Boolean(address) && isValidEmail(address) && mailConfigured();
  // The customer waved it away. Common on a sale handed over as it is rung up,
  // and the honest response is to build nothing rather than to build a receipt
  // and quietly drop it: no mail, no paper, and no address anywhere near this
  // request. The sale is recorded exactly as any other — declining the ticket
  // does not decline the accounting.
  const declined = body.noReceipt === true;

  if (!declined) {
    const locale = await getLocale();
    const messages = messagesFor(locale);
    const built = buildReceipt(
      [
        {
          id: order.id as string,
          items: verified,
          subtotal: pricing.subtotal,
          service_fee: pricing.serviceFee,
          tip: pricing.tip,
          discount: pricing.discount,
          total: pricing.total,
          currency: restaurant.currency as string,
          created_at: new Date().toISOString(),
          pay_method: method,
        },
      ],
      {
        name: (restaurant as { name?: string }).name ?? "TableTap",
        timeZone: (restaurant.timezone as string | null) ?? DEFAULT_TIME_ZONE,
        locale: dateLocale(locale),
      },
      (key, vars) => translate(messages, key, vars),
    );
    if (wantsMail) {
      const mail = await sendMail({
        to: address,
        subject: built.subject,
        text: built.text,
        html: built.html,
        fromName: (restaurant as { name?: string }).name ?? "TableTap",
      });
      receipt = mail.sent ? "sent" : "failed";
      // Asked for by email and it did not go: hand back the ticket so the
      // cashier can print it. Telling them to print without giving them
      // anything to print is not an answer.
      if (!mail.sent) receiptHtml = built.html;
      if (mail.sent) {
        await db
          .from("orders")
          .update({ receipt_sent_at: new Date().toISOString() })
          .eq("id", order.id);
      }
    } else {
      // Nobody gave an address, so it is printed. The same document either
      // way — one goes in an email, one goes through the printer.
      receiptHtml = built.html;
    }
  }

  return { receipt, receiptHtml };
}
