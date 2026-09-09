/**
 * How the browser writes the session cookie.
 *
 * Supabase's browser client writes it with `document.cookie`, which is why it
 * cannot be `httpOnly` — the client has to read the session back. That is the
 * library's model rather than something to work around. What it does mean is
 * that the one remaining flag was worth setting and was not: on the HTTPS
 * production site the session cookie went out without `Secure`.
 *
 * HSTS is already sent with `preload`, so a browser will not make a plaintext
 * request to the domain at all and nothing was leaking. This says it on the
 * cookie itself rather than leaving it to a second header.
 *
 * Keyed on the page's own protocol, not on NODE_ENV. A build flag would have
 * to be guessed right for an environment this can never be tested in, and
 * guessing it wrong sets `Secure` on a cookie served over http — which the
 * browser then refuses to store, and nobody can log in. The protocol is the
 * thing actually being asked about, and it is right by construction: http on
 * localhost, https everywhere it matters.
 */
export function browserCookieOptions(): { secure: boolean } {
  return { secure: typeof location !== "undefined" && location.protocol === "https:" };
}
