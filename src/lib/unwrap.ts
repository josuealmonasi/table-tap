/**
 * Errors that are really answers, not faults.
 *
 * PGRST116 — `.single()` matched no rows: the restaurant isn't there.
 * 22P02    — Postgres couldn't parse the id as a uuid. A value it can't even
 *            read matches nothing by definition, so this is a 404 too. It has
 *            to be listed here or a mistyped QR link would offer the diner a
 *            "try again" button that can never succeed.
 */
const NOT_A_FAULT = new Set(["PGRST116", "22P02"]);

/**
 * Unwraps a Supabase result, telling a real answer apart from a failure.
 *
 * These queries used to be destructured as `{ data }`, dropping `error` on the
 * floor. That turned every transient fault — a network blip, an exhausted
 * connection pool — into a confident lie: a null restaurant became a "page not
 * found" for a customer holding a perfectly valid QR code, and a null item list
 * became an empty menu. Both look permanent and correct, so nobody retries and
 * nothing reaches the logs.
 *
 * The NOT_A_FAULT codes are the ones that ARE an answer: the restaurant
 * genuinely does not exist, so they pass through as null and the caller may
 * 404. Everything else throws, which renders the error boundary ("try again")
 * and surfaces the fault.
 */
export function unwrap<T>(
  res: { data: T | null; error: { code?: string; message: string } | null },
  what: string,
): T | null {
  if (res.error && !NOT_A_FAULT.has(res.error.code ?? "")) {
    throw new Error(`Could not load ${what}: ${res.error.message}`);
  }
  return res.data;
}
