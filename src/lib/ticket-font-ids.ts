// The ticket's typefaces the owner chooses between (owner's request,
// 2026-11-11): Archivo — the app's own, and the default — IBM Plex Mono for a
// receipt-printer look, and the classic Courier. Client-safe: the settings
// card lists them; the files live in ticket-fonts.ts.
export const TICKET_FONTS = ["archivo", "plex", "classic"] as const;
export type TicketFontId = (typeof TICKET_FONTS)[number];
export const DEFAULT_TICKET_FONT: TicketFontId = "archivo";

export function isTicketFont(value: unknown): value is TicketFontId {
  return typeof value === "string" && (TICKET_FONTS as readonly string[]).includes(value);
}
