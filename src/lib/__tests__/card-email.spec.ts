import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ claimed: [] as unknown[], updates: [] as unknown[], sent: [] as unknown[], card: { email: "ana@example.invalid", email_unsubscribe: "11111111-1111-4111-8111-111111111111" } as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: state.claimed, error: null }),
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === "loyalty_cards" ? state.card : null, error: null });
      q.single = async () => ({ data: { name: "Demo Bistro", timezone: "America/Mexico_City" }, error: null });
      q.update = (patch: unknown) => ({ in: async (_c: string, ids: string[]) => { state.updates.push({ patch, ids }); return { error: null }; } });
      return q;
    },
  }),
}));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true, sendMail: async (m: unknown) => { state.sent.push(m); return { sent: true }; } }));
vi.mock("@/lib/receipt-source", () => ({ readOrderReceipt: async () => ({ orders: [], restaurantId: "r", tableId: null }) }));
vi.mock("@/lib/receipt", () => ({
  buildReceipt: () => ({ subject: "Tu recibo", text: "Total", html: "<p>Total</p>" }),
  receiptModel: () => ({ code: "ORD-1" }),
}));
vi.mock("@/lib/ticket-pdf", () => ({ ticketPdf: async () => Buffer.from("%PDF-") }));
vi.mock("@/lib/ticket-place", () => ({ ticketPlace: async () => ({ name: "Demo Bistro" }), ticketText: () => ({}) }));
vi.mock("@/lib/ticket-loyalty", () => ({ ticketLoyalty: () => null }));

const { drainTicketEmails } = await import("@/lib/ticket-email");
const { maskEmail, normalizeEmail, emailForRole } = await import("@/lib/loyalty/card-email");
const row = (id: string, order: string, session: string | null) => ({ id, restaurant_id: "r", card_id: "c", order_id: order, session_id: session, attempts: 1 });

beforeEach(() => { state.claimed = []; state.updates = []; state.sent = []; });

it("normalizes and masks the card's address", () => {
  expect(normalizeEmail("  Ana@Example.Invalid ")).toBe("ana@example.invalid");
  expect(normalizeEmail("nope")).toBeNull();
  expect(maskEmail("ana@example.invalid")).toBe("a***@example.invalid");
  expect(emailForRole("ana@example.invalid", false)).toBe("a***@example.invalid");
  expect(emailForRole("ana@example.invalid", true)).toBe("ana@example.invalid");
});

it("sends a table's orders paid together as one email, with the PDF and the stop link", async () => {
  state.claimed = [row("1", "o1", "s"), row("2", "o2", "s")];
  await drainTicketEmails();
  expect(state.sent).toHaveLength(1);
  const mail = state.sent[0] as { to: string; attachments: { filename: string }[]; headers: Record<string, string>; html: string };
  expect(mail.to).toBe("ana@example.invalid");
  expect(mail.attachments[0].filename).toBe("ticket-ORD-1.pdf");
  expect(mail.headers["List-Unsubscribe"]).toContain("/tickets/stop?t=11111111-1111-4111-8111-111111111111");
  expect(state.updates).toEqual([{ patch: expect.objectContaining({ outcome: "sent" }), ids: ["1", "2"] }]);
});

it("finishes as no_email when the address was removed before sending", async () => {
  state.card = { email: null, email_unsubscribe: null };
  state.claimed = [row("1", "o1", null)];
  await drainTicketEmails();
  expect(state.sent).toHaveLength(0);
  expect(state.updates).toEqual([{ patch: expect.objectContaining({ outcome: "no_email" }), ids: ["1"] }]);
  state.card = { email: "ana@example.invalid", email_unsubscribe: "11111111-1111-4111-8111-111111111111" };
});
