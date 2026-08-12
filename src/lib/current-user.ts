import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * The logged-in user, resolved once per request.
 *
 * `auth.getUser()` is not a local cookie read — it calls the auth server to
 * verify the token, which is why it is trustworthy and also why it costs a
 * round trip. The layout, the page and any route guard all need the same
 * answer, so without this they each paid for it separately: a dashboard render
 * made four identical calls before this existed.
 *
 * React's `cache` scopes the memo to one request, so two users are never
 * confused with each other — a module-level variable would do exactly that.
 */
export const currentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
