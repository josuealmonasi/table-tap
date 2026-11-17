import { escapeHtml } from "@/lib/html";
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
    html: receipt.html
      .replace(`<p style="margin-top:24px;color:#70707a;font-size:12px">${copy.receiptFooter.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`, "")
      .replace(/<\/div>$/, `<p style="margin-top:24px;color:#70707a;font-size:12px">${escapeHtml(copy.footer)} <a style="color:#0e6e6e" href="${escapeHtml(copy.stop)}">${escapeHtml(copy.stopLabel)}</a></p>\n</div>`),
  };
}
