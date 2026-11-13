import { mailText } from "@/lib/mail-text";
import type { Receipt } from "@/lib/receipt";

/** The card keeps the address, so its ticket needs the card's own footer. */
export function ticketMail(
  receipt: Receipt,
  copy: { receiptFooter: string; footer: string; stopLabel: string; stop: string },
): Pick<Receipt, "text" | "html"> {
  const kept = (text: string) => text.split(copy.receiptFooter).join("");
  return {
    text: mailText([kept(receipt.text), "", copy.footer, "", `${copy.stopLabel}:`, copy.stop]),
    html: `${kept(receipt.html)}<p style="margin-top:24px;color:#6E7A74;font-size:12px">${copy.footer} <a href="${copy.stop}">${copy.stopLabel}</a></p>`,
  };
}
