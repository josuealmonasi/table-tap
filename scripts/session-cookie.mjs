/** Supabase SSR's project cookie, shared by HTTP and browser gates. */
export function sessionCookie(session, supabaseUrl) {
  // A null cookie redirects to login, where an empty sweep can look like a pass.
  if (!session) throw new Error("cannot build a session cookie: no session");
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  return {
    name: `sb-${ref}-auth-token`,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
  };
}

export function sessionCookieHeader(session, supabaseUrl) {
  const { name, value } = sessionCookie(session, supabaseUrl);
  return `${name}=${value}`;
}
