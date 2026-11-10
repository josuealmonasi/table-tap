import { expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, not: () => read() };
  return q;
} }) }));
const { foundersTaken } = await import("@/lib/plan-server");

it("a founder count that could not be read is refused, never taken as zero (E2)", async () => {
  read.mockResolvedValueOnce({ count: null, error: { message: "timeout" } });
  await expect(foundersTaken()).rejects.toThrow(/founding places/);
  read.mockResolvedValueOnce({ count: 50, error: null });
  await expect(foundersTaken()).resolves.toBe(50);
});
