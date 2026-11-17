import { expect, it, vi } from "vitest";
import { ticketPlace } from "@/lib/ticket-place";
import { messagesFor, translate } from "@/lib/i18n";
import type { createAdminClient } from "@/lib/supabase/admin";

it("reads the saved regime for both the emailed ticket and settings preview", async () => {
  const select = vi.fn((_columns: string) => ({ eq: () => ({ single: async () => ({ data: { name: "Demo", logo_url: null, tax_regime: "626" }, error: null }) }) }));
  const db = { from: () => ({ select }) } as unknown as ReturnType<typeof createAdminClient>;
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);
  const email = await ticketPlace(db, "r", t);
  const preview = await ticketPlace(db, "r", t);
  expect(select.mock.calls[0][0]).toContain("tax_regime");
  expect(email.regime).toBe(preview.regime);
  expect(email.regime).toContain("626");
});
