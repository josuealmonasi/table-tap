/**
 * The address a link back to the app is built on: the one this request
 * reached, never the request's `Origin` header.
 *
 * `Origin` is whatever the caller says. A script sending its own requests set
 * it to another site, and the statement email the app then sent, from its own
 * verified sender, to any address, carried a "pay" link to that site. The
 * request's own URL is the host the deployment actually answered on.
 */
export function siteOrigin(req: Request): string {
  return new URL(req.url).origin;
}
