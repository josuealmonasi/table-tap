import { domainToASCII } from "node:url";

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address actually delivers to, for counting mail per inbox.
 *
 * `Owner+1@x.com`, `owner+2@x.com` and, at Gmail, `o.w.n.e.r@googlemail.com`
 * all land in one mailbox. A ceiling keyed by the exact string let a stranger
 * keep that mailbox receiving mail by changing the spelling every time.
 * Only for keys: mail is still stored and sent to the address as typed.
 */
export function canonicalInbox(email: string): string {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0) return address;
  let local = address.slice(0, at);
  const rawDomain = address.slice(at + 1);
  const domain = domainToASCII(rawDomain) || rawDomain;
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) return `${local.replaceAll(".", "")}@gmail.com`;
  return `${local}@${domain}`;
}
