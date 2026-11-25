import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeHtml } from "@/lib/html";
import { DEFAULT_LOCALE, isLocale, messagesFor, translate, type Locale } from "@/lib/i18n";

/**
 * Outside addresses that receive a restaurant's daily digest (owner decision
 * 2026-11-25): at most five, added by the owner, and nothing is sent to one
 * until its holder confirms from that inbox. Each digest carries the
 * address's own stop link. Confirm tokens are stored hashed (they grant the
 * subscription); the stop token only removes it, so it is kept to build links.
 */

export const MAX_DIGEST_RECIPIENTS = 5;
/** A confirmation link works for this long; an unconfirmed address is then deleted. */
export const CONFIRM_DAYS = 7;

export interface DigestRecipient {
  id: string;
  email: string;
  status: "pending" | "confirmed";
  created_at: string;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function validToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

export async function listRecipients(restaurantId: string): Promise<DigestRecipient[]> {
  const { data, error } = await createAdminClient().from("digest_recipients")
    .select("id, email, status, created_at").eq("restaurant_id", restaurantId).order("created_at");
  if (error) throw new Error(`Could not read the digest recipients: ${error.message}`);
  return (data ?? []) as DigestRecipient[];
}

/** Confirmed addresses with their stop links, for the digest sender. */
export async function confirmedRecipients(
  restaurantId: string, db: Pick<ReturnType<typeof createAdminClient>, "from"> = createAdminClient(),
): Promise<{ email: string; stopToken: string }[]> {
  const { data, error } = await db.from("digest_recipients")
    .select("email, stop_token").eq("restaurant_id", restaurantId).eq("status", "confirmed");
  if (error) throw new Error(`Could not read the digest recipients: ${error.message}`);
  return (data ?? []).map(r => ({ email: r.email as string, stopToken: r.stop_token as string }));
}

export type AddOutcome = "added" | "exists" | "full" | "not_found";

export async function addRecipient(restaurantId: string, email: string, actor: string): Promise<{ outcome: AddOutcome; token?: string }> {
  const token = newToken();
  const { data, error } = await createAdminClient().rpc("add_digest_recipient_v1", {
    p_restaurant: restaurantId, p_email: email, p_confirm_hash: tokenHash(token), p_stop_token: newToken(), p_actor: actor,
  });
  if (error) throw new Error(`Could not add the digest recipient: ${error.message}`);
  const outcome = data as AddOutcome;
  return outcome === "added" ? { outcome, token } : { outcome };
}

/** A fresh link for a pending address: the old one stops working. Null when it is not pending here. */
export async function renewConfirmation(restaurantId: string, id: string): Promise<{ email: string; token: string } | null> {
  const token = newToken();
  const { data, error } = await createAdminClient().from("digest_recipients")
    .update({ confirm_token_hash: tokenHash(token), confirm_sent_at: new Date().toISOString() })
    .eq("restaurant_id", restaurantId).eq("id", id).eq("status", "pending").select("email").maybeSingle();
  if (error) throw new Error(`Could not renew the confirmation: ${error.message}`);
  return data ? { email: data.email as string, token } : null;
}

export async function removeRecipient(restaurantId: string, id: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("digest_recipients")
    .delete().eq("restaurant_id", restaurantId).eq("id", id).select("id");
  if (error) throw new Error(`Could not remove the digest recipient: ${error.message}`);
  return Boolean(data?.length);
}

/** The holder confirms: one use, within CONFIRM_DAYS. Answers the restaurant's name, or null. */
export async function confirmRecipient(token: string): Promise<string | null> {
  const since = new Date(Date.now() - CONFIRM_DAYS * 86_400_000).toISOString();
  const { data, error } = await createAdminClient().from("digest_recipients")
    .update({ status: "confirmed", confirm_token_hash: null, confirmed_at: new Date().toISOString() })
    .eq("confirm_token_hash", tokenHash(token)).eq("status", "pending").gt("confirm_sent_at", since)
    .select("restaurant_id").maybeSingle();
  if (error) throw new Error(`Could not confirm the digest recipient: ${error.message}`);
  return data ? await restaurantName(data.restaurant_id as string) : null;
}

/** The holder stops: the address is deleted. Answers the restaurant's name, or null. */
export async function stopRecipient(token: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("digest_recipients")
    .delete().eq("stop_token", token).select("restaurant_id").maybeSingle();
  if (error) throw new Error(`Could not stop the digest: ${error.message}`);
  return data ? await restaurantName(data.restaurant_id as string) : null;
}

async function restaurantName(id: string): Promise<string> {
  const { data } = await createAdminClient().from("restaurants").select("name").eq("id", id).maybeSingle();
  return (data?.name as string) ?? "";
}

/** The one email an added address receives before it confirms. */
export function confirmationMail(m: { restaurant: string; link: string }, locale: string | null | undefined) {
  const l: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  const t = (key: string) => translate(messagesFor(l), key, { restaurant: m.restaurant, days: String(CONFIRM_DAYS) });
  const subject = t("digestRecipientMail.confirmSubject");
  const intro = t("digestRecipientMail.confirmIntro");
  const ignore = t("digestRecipientMail.confirmIgnore");
  const button = t("digestRecipientMail.confirmButton");
  return { subject, text: `${intro}\n\n${button}: ${m.link}\n\n${ignore}`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#16211C">`
      + `<p>${escapeHtml(intro)}</p>`
      + `<p><a href="${escapeHtml(m.link)}" style="display:inline-block;padding:10px 16px;background:#0e6e6e;color:#fff;border-radius:8px;text-decoration:none">${escapeHtml(button)}</a></p>`
      + `<p style="color:#6b6b72;font-size:13px">${escapeHtml(ignore)}</p></div>` };
}
