import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";

const state = vi.hoisted(() => ({ places: [] as { regime: string | null; name: string }[], columns: [] as string[] }));
const row = { name: "Real restaurant", logo_url: null, tax_regime: "626", currency: "MXN", timezone: "UTC", tax_pct: 16 };
const db = { from: () => ({ select: (columns: string) => {
  state.columns.push(columns);
  return { eq: () => ({ single: async () => ({ data: row, error: null }) }) };
} }) } as unknown as ReturnType<typeof createAdminClient>;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false }));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r" }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/lib/receipt-source", () => ({ readOrderReceipt: async () => ({ orders: [], restaurantId: "r", tableId: null }) }));
vi.mock("@/lib/receipt", () => ({ buildReceipt: () => ({ subject: "Ticket", text: "", html: "" }), receiptModel: () => ({ code: "ORD-63F4" }) }));
vi.mock("@/lib/ticket-loyalty", () => ({ ticketLoyalty: () => null }));
vi.mock("@/lib/ticket-pdf", () => ({ ticketPdf: async (_model: unknown, place: { regime: string | null; name: string }) => {
  state.places.push(place); return Buffer.from("pdf");
} }));

it("uses the same saved fiscal regime in the email PDF and settings preview", async () => {
  const { renderTicketMail } = await import("@/lib/ticket-email-body");
  const { GET } = await import("@/app/api/settings/ticket-preview/route");
  await renderTicketMail(db, "r", ["order"], "secret");
  const preview = await GET(new NextRequest("https://example.com/api/settings/ticket-preview?font=plex"));
  expect(preview.status).toBe(200);
  expect(state.places).toHaveLength(2);
  expect(state.places[0].regime).toBe("Régimen fiscal: 626 Régimen Simplificado de Confianza");
  expect(state.places[1]).toMatchObject({ name: row.name, regime: state.places[0].regime });
  expect(state.columns.filter(columns => columns.includes("tax_regime"))).toHaveLength(2);
});
