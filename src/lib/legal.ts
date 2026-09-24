/**
 * Which terms are in force, and whether somebody has accepted them.
 *
 * The version is a date rather than a number so a record of acceptance says
 * *what* was accepted without going digging: "2026-08-18" is a document we can
 * produce. Bump it only when the terms change in a way that matters — every
 * bump asks every restaurant again, and asking for consent to a typo fix
 * teaches people to click through without reading.
 *
 * The other half of that rule is the one that actually went wrong: the text
 * moved twice — the camera clause, then the device identifier — and this line
 * did not, so every restaurant stayed on their old acceptance and was never
 * shown either. A version nobody bumps is a consent record that describes a
 * document the person never saw. `legal.spec.ts` now holds a fingerprint of
 * the text and fails when the two drift apart, so the decision to bump or not
 * is made deliberately rather than forgotten.
 */
export const TERMS_VERSION = "2026-09-24";

/**
 * Where the documents live.
 *
 * The links point at PDFs: a legal document is something somebody keeps, and a
 * file downloads, prints and carries its version on every page. The readable
 * pages stay for anyone who would rather not open a file.
 */
export const TERMS_PATH = "/legal/terminos.pdf";
export const PRIVACY_PATH = "/legal/aviso-de-privacidad.pdf";
export const TERMS_PAGE = "/terminos";
export const PRIVACY_PAGE = "/privacidad";

/**
 * Whether this restaurant still owes us an acceptance.
 *
 * Null means they signed up before terms existed, which is the same answer as
 * an out-of-date version: ask again. Nothing is assumed on anyone's behalf.
 */
export function needsTerms(accepted: string | null | undefined): boolean {
  return accepted !== TERMS_VERSION;
}
