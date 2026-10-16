import type { User } from "@supabase/supabase-js";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

/** Logins asked for at a time; Supabase serves at most 1000 a page. */
const PER_PAGE = 1000;

/**
 * Every login on the platform, however many there are.
 *
 * `auth.admin.listUsers` answers one page and says nothing about the rest, so
 * the platform admin's list of logins stopped at the thousandth, and every
 * owner past it read as nobody. Pages until one comes back empty, like
 * `everyRow`, and throws on a failed page: a list of logins with a hole in it
 * is a wrong list.
 */
export async function everyLogin(db: Admin): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`Could not load the logins: ${error.message}`);
    if (!data.users.length) return users;
    users.push(...data.users);
  }
}
