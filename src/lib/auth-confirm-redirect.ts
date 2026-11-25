import { NextResponse } from "next/server";

/** Move a legacy email token into the browser-only part of the URL. */
export function authConfirmRedirect(url: URL, tokenHash: string, type: string | null, status: 302 | 303): NextResponse {
  const fragment = new URLSearchParams({ token_hash: tokenHash });
  if (type !== null) fragment.set("type", type);
  url.hash = fragment.toString();
  return NextResponse.redirect(url, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
