/**
 * Only our own confirm page may post here. A form on another site could
 * otherwise post ITS account's token and sign a visitor into the attacker's
 * account (login CSRF), where they might type their real details. Browsers
 * send Sec-Fetch-Site on every form post; Origin is the fallback.
 */
export function sameSitePost(req: Request, origin: string): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  return req.headers.get("origin") === origin;
}
