import { describe, expect, it } from "vitest";
import { everyLogin } from "@/lib/logins";

/** An auth admin serving `total` logins, `cap` a page at most, like Supabase. */
function auth(total: number, cap = 1000, failOn?: number) {
  const pages: number[] = [];
  const db = {
    auth: {
      admin: {
        listUsers: async ({ page, perPage }: { page: number; perPage: number }) => {
          pages.push(page);
          if (page === failOn) return { data: { users: [] }, error: { message: "timeout" } };
          const size = Math.min(perPage, cap);
          const from = (page - 1) * size;
          const users = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => ({ id: `u${from + i}` }));
          return { data: { users }, error: null };
        },
      },
    },
  };
  return { db: db as never, pages };
}

describe("every login on the platform", () => {
  it("reads past the first page until a page comes back empty", async () => {
    const a = auth(2350);
    const users = await everyLogin(a.db);
    expect(users).toHaveLength(2350);
    expect(new Set(users.map(u => u.id)).size).toBe(2350);
    expect(a.pages).toEqual([1, 2, 3, 4]);
  });

  it("is not fooled by a server that serves fewer a page than asked", async () => {
    const a = auth(450, 200);
    expect(await everyLogin(a.db)).toHaveLength(450);
  });

  it("throws on a failed page instead of returning part of the list", async () => {
    await expect(everyLogin(auth(2350, 1000, 2).db)).rejects.toThrow(/Could not load the logins: timeout/);
  });
});
