import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: vi.fn() }));
import { owedCents } from "@/lib/write-off-rest";
it.each([[1.005, 0.5, 51], [2.675, 2, 68], [1.005, 0, 101]])("matches decimal cents for total %s less %s", (total, paid, expected) => {
  expect(owedCents([{ id: "order", total }], new Map([["order", paid]]))).toBe(expected);
});
