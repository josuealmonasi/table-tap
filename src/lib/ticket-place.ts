import type { createAdminClient } from "@/lib/supabase/admin";
import type { TicketPlace, TicketText } from "@/lib/ticket-pdf";

type Db = ReturnType<typeof createAdminClient>;
type T = (key: string, vars?: Record<string, string | number>) => string;

interface FiscalRow {
  name: string; logo_url: string | null; legal_name: string | null; rfc: string | null; tax_regime: string | null;
  address_street: string | null; address_ext_number: string | null; address_int_number: string | null;
  address_colonia: string | null; address_postal_code: string | null; address_municipality: string | null;
  address_state: string | null; ticket_phone: string | null; ticket_font: string | null;
}

/** The address as a ticket prints it: street and number, colonia and CP, municipio and estado. */
export function ticketAddress(r: Partial<FiscalRow>): string[] {
  const street = [r.address_street, r.address_ext_number].filter(Boolean).join(" ")
    + (r.address_int_number ? `, Int. ${r.address_int_number}` : "");
  const colony = [r.address_colonia ? `Col. ${r.address_colonia}` : "", r.address_postal_code ? `C.P. ${r.address_postal_code}` : ""]
    .filter(Boolean).join(", ");
  const city = [r.address_municipality, r.address_state].filter(Boolean).join(", ");
  return [street, colony, city].filter(line => line.trim().length > 0);
}

const LOGO_MAX = 2_000_000;

/** Only our own public storage: a stored URL never makes the server fetch somewhere else. */
export function ownStorageUrl(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const own = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://invalid.local");
    return u.protocol === "https:" && u.host === own.host && u.pathname.startsWith("/storage/v1/object/public/");
  } catch { return false; }
}

/**
 * Only PNG and JPEG reach pdfkit; anything else (an emoji, a WebP, a dead link)
 * prints no logo. No redirects, a deadline, and the size counted while reading.
 */
async function logoBytes(url: string | null): Promise<Buffer | null> {
  if (!ownStorageUrl(url)) return null;
  try {
    const res = await fetch(url!, { signal: AbortSignal.timeout(4000), redirect: "error" });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !res.body || !/image\/(png|jpe?g)/.test(type)) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > LOGO_MAX) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch { return null; }
}

/** The issuer block of a ticket, read server-side: these columns are never granted to anon. */
export async function ticketPlace(db: Db, restaurantId: string, t: T): Promise<TicketPlace> {
  const { data, error } = await db.from("restaurants").select(
    "name, logo_url, legal_name, rfc, tax_regime, address_street, address_ext_number, address_int_number, "
    + "address_colonia, address_postal_code, address_municipality, address_state, ticket_phone, ticket_font",
  ).eq("id", restaurantId).single();
  if (error || !data) throw new Error(`Could not read the ticket's restaurant: ${error?.message ?? "missing"}`);
  const r = data as unknown as FiscalRow;
  return {
    name: r.name, legalName: r.legal_name, rfc: r.rfc,
    regime: r.tax_regime ? t("saleTicket.regime", { code: r.tax_regime, name: t(`fiscal.regimes.${r.tax_regime}`) }) : null,
    addressLines: ticketAddress(r), phone: r.ticket_phone, logo: await logoBytes(r.logo_url), font: r.ticket_font,
  };
}

/** The ticket's fixed words in the reader's language. */
export function ticketText(t: T): TicketText {
  return {
    folio: t("saleTicket.folio"), table: label => t("saleTicket.table", { label }),
    header: { qty: t("saleTicket.qty"), item: t("saleTicket.item"), price: t("saleTicket.price"), amount: t("saleTicket.amount") },
    articles: n => t("saleTicket.articles", { n }),
    payMethod: m => t(m === "cash" ? "saleTicket.paidCash" : m === "card" || m === "terminal" ? "saleTicket.paidCard" : "saleTicket.paidOther"),
    loyaltyTitle: t("saleTicket.loyaltyTitle"),
    loyaltyLine: l => t("saleTicket.loyaltyLine", { last4: l.last4, progress: l.progress, goal: l.goal }),
    qrHint: t("saleTicket.qrHint"), thanks: t("saleTicket.thanks"), notFiscal: t("receipt.notFiscal"),
  };
}
