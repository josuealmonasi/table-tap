import { beforeEach, expect, it, vi } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";
import { splitVatRate } from "@/lib/receipt-vat-source";

const read = vi.fn(), select = vi.fn(), eq = vi.fn();
const db = { from: vi.fn(() => ({ select })) } as unknown as ReturnType<typeof createAdminClient>;
beforeEach(() => {
  vi.clearAllMocks();
  select.mockReturnValue({ eq });
  eq.mockReturnValue({ in: read });
  read.mockResolvedValue({ data: [{ id: "a", tax_pct: 16 }, { id: "b", tax_pct: "16" }], error: null });
});

it("reads only this restaurant's frozen order ids and their saved rates", async () => {
  expect(await splitVatRate(db, "r1", ["a", "b"])).toBe(16);
  expect(eq).toHaveBeenCalledWith("restaurant_id", "r1");
  expect(read).toHaveBeenCalledWith("id", ["a", "b"]);
  expect(select).toHaveBeenCalledWith("id, tax_pct");
});

it.each([
  [{ id: "a", tax_pct: 16 }, { id: "b", tax_pct: 8 }],
  [{ id: "a", tax_pct: 16 }, { id: "b", tax_pct: null }],
  [{ id: "a", tax_pct: 16 }],
  [{ id: "a", tax_pct: -1 }, { id: "b", tax_pct: -1 }],
])("omits IVA when a split's saved rate is ambiguous or incomplete: %j", async (...rows) => {
  read.mockResolvedValue({ data: rows, error: null });
  expect(await splitVatRate(db, "r1", ["a", "b"])).toBeNull();
});

it("leaves IVA off after a failed optional tax read", async () => {
  read.mockResolvedValue({ data: null, error: { message: "unavailable" } });
  expect(await splitVatRate(db, "r1", ["a", "b"])).toBeNull();
});

it("leaves IVA off after a rejected optional tax read", async () => {
  read.mockRejectedValue(new Error("connection dropped"));
  expect(await splitVatRate(db, "r1", ["a", "b"])).toBeNull();
});
