import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Admin client — uses the SECRET key. Bypasses Row Level Security entirely.
// SERVER-ONLY. Never import this into a client component.
// Used for trusted writes: creating orders after payment, updating status, etc.
//
// The secret key cannot be used in a browser (Supabase rejects it on the
// User-Agent), but we still guard against accidental client bundling.
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must never be called in the browser.");
  }

  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
