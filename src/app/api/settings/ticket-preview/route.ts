import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { actingOwner } from "@/lib/api-guard";
import { isRoomLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatMoney } from "@/lib/format";
import { DEFAULT_TIME_ZONE } from "@/lib/open-menus";
import { DEFAULT_LOCALE, messagesFor, translate } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isTicketFont } from "@/lib/ticket-font-ids";
import { ticketPdf } from "@/lib/ticket-pdf";
import { ticketPlace, ticketText } from "@/lib/ticket-place";
import type { ReceiptModel } from "@/lib/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/ticket-preview?font=plex — a sample ticket in one of the
 * three typefaces, so the owner chooses by looking (owner's request,
 * 2026-11-11). The header is the restaurant's own — name, logo, fiscal data,
 * address — and the lines, the visit card and the QR are made up. The owner's,
 * because the ticket font is chosen with the fiscal data, which is theirs.
 */
export async function GET(req: NextRequest) {
  if (await isRoomLimited(req, "ticket-preview", 20)) return await apiError("apiErr.tooManyRequests", 429);
  const actor = await actingOwner();
  if (!actor) return await apiError("apiErr.forbidden", 403);
  const font = req.nextUrl.searchParams.get("font");
  if (!isTicketFont(font)) return await apiError("apiErr.invalidRequest", 400);
  const locale = (await getLocale()) ?? DEFAULT_LOCALE;
  const messages = messagesFor(locale);
  const t = (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);
  try {
    const db = createAdminClient();
    const { data: r, error } = await db.from("restaurants").select("currency, timezone")
      .eq("id", actor.restaurantId).single();
    if (error || !r) return await apiError("apiErr.generic", 503);
    const cur = (r.currency as string) || "MXN";
    const lines = [
      { qty: 2, name: t("ticketFont.sampleDish1"), unit: 145 },
      { qty: 1, name: t("ticketFont.sampleDish2"), unit: 98 },
      { qty: 3, name: t("ticketFont.sampleDish3"), unit: 42 },
    ].map(l => ({ ...l, label: `${l.qty}× ${l.name}`, amount: l.qty * l.unit }));
    const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
    const tip = Math.round(subtotal * 0.1);
    const model: ReceiptModel = {
      code: "ORD-0000",
      when: new Date().toLocaleString(locale === "en" ? "en-US" : "es-MX", {
        dateStyle: "medium", timeStyle: "short", timeZone: (r.timezone as string | null) ?? DEFAULT_TIME_ZONE,
      }),
      tableLabel: "4", cur, lines, rows: [[t("totals.tip"), formatMoney(tip, cur)]],
      // The sample's IVA line, at the owner's saved rate: the sale without the tip.
      totalLabel: t("totals.total"), paid: subtotal + tip, payMethod: "cash", vatBase: subtotal,
    };
    const place = await ticketPlace(db, actor.restaurantId, t);
    const loyalty = { last4: "0000", progress: 5, goal: 8, message: t("ticketFont.sampleLoyalty") };
    const site = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : req.nextUrl.origin;
    const pdf = await ticketPdf(model, place, ticketText(t), loyalty, new URL("/dashboard/bills", site).toString(), font);
    return new NextResponse(new Uint8Array(pdf), { headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="ticket-${font}.pdf"`,
      "cache-control": "no-store",
    } });
  } catch {
    return await apiError("apiErr.generic", 503);
  }
}
