import { createBrowserClient } from "@supabase/ssr";

// Browser client — uses the PUBLISHABLE key (safe to ship to the browser).
// Respects Row Level Security. Use this in client components.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
