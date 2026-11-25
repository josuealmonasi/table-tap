import { digestStopToken } from "@/lib/digest-stop-token";
import { confirmedRecipients } from "@/lib/digest-recipients";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/i18n";
import { MAIL_BATCH_SIZE, sendMail, type MailBatch } from "@/lib/mail";
import { everyRow } from "@/lib/paged";
import { readDigestFigures } from "./digest-figures";
import { digestMail } from "./digest-mail";
import { hasTime, runBatch, type PendingItem, type RecoveryContext } from "./job";

interface Due extends PendingItem {
  owner_id: string | null;
  name: string;
  currency: string;
  timezone: string;
  digest_day: string;
}

interface Recipient {
  user_id: string;
  email: string;
  is_owner: boolean;
  locale: string | null;
}

export async function recoverDailyDigests(context: RecoveryContext) {
  const { db } = context;
  return runBatch<Due>("daily digest", context, (limit, offset = 0) => db.from("daily_digests_due")
    .select("restaurant_id, owner_id, name, currency, timezone, digest_day, created_at", { count: "exact" })
    .order("created_at").order("restaurant_id").range(offset, offset + limit - 1).returns<Due[]>(), async row => {
    const figures = await readDigestFigures(db, row, new Date());
    if (!figures) return false;
    const people = await everyRow<Recipient>((a, b) => db.from("daily_digest_recipients")
      .select("user_id, email, is_owner, locale").eq("restaurant_id", row.restaurant_id)
      .order("is_owner", { ascending: false }).order("user_id").range(a, b), "the digest recipients");
    // The owner's extra addresses, confirmed from their own inboxes (owner 2026-11-25).
    const outside = await confirmedRecipients(row.restaurant_id, db);
    if (!people.length && !outside.length) return false;
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tabletap.shop";
    const dashboard = new URL("/dashboard", origin).href;
    // Finish building every message before taking the claim.
    const mails = people.map(person => {
      const locale = isLocale(person.locale) ? person.locale : DEFAULT_LOCALE;
      const token = digestStopToken(person.user_id, locale);
      return { to: person.email, ...digestMail(figures, { ...row, locale, owner: person.is_owner, dashboard,
        stop: new URL(`/digest/opt-out?t=${token}`, origin).href,
        oneClick: new URL(`/api/digest/opt-out?t=${token}`, origin).href }) };
    });
    if (outside.length) {
      const locale = await readOutsideLocale(db, row.owner_id, people);
      for (const r of outside) {
        mails.push({ to: r.email, ...digestMail(figures, { ...row, locale, owner: false, guest: true, dashboard,
          stop: new URL(`/digest/stop?t=${r.stopToken}`, origin).href,
          oneClick: new URL(`/api/digest/stop?t=${r.stopToken}`, origin).href }) });
      }
    }

    if (!hasTime(context)) return false;
    const claim = db.from("restaurants").update({ digest_sent_for: row.digest_day })
      .eq("id", row.restaurant_id).eq("timezone", row.timezone).eq("currency", row.currency)
      .or(`digest_sent_for.is.null,digest_sent_for.lt.${row.digest_day}`);
    const { data: claimed, error } = await (row.owner_id ? claim.eq("owner_id", row.owner_id) : claim.is("owner_id", null)).select("id");
    if (error) throw new Error("Could not claim the daily digest", { cause: error });
    if (!claimed?.length) return false;

    await deliver(context, row, mails);
    return true;
  }, "restaurant local 07:00");
}

async function readOutsideLocale(db: RecoveryContext["db"], ownerId: string | null, people: Recipient[]): Promise<Locale> {
  if (!ownerId) return DEFAULT_LOCALE;
  const owner = people.find(person => person.user_id === ownerId);
  if (owner) return isLocale(owner.locale) ? owner.locale : DEFAULT_LOCALE;

  // An owner can opt out without changing the language of their outside recipients.
  const { data, error } = await db.auth.admin.getUserById(ownerId);
  if (error && error.code !== "user_not_found") throw new Error("Could not read the digest owner's locale", { cause: error });
  const locale: unknown = data?.user?.user_metadata.locale;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

async function deliver(context: RecoveryContext, row: Due, mails: MailBatch["messages"]): Promise<void> {
  let accepted = 0;
  for (let offset = 0; offset < mails.length; offset += MAIL_BATCH_SIZE) {
    const remaining = context.deadline - Date.now();
    if (remaining <= 0) break;
    const messages = mails.slice(offset, offset + MAIL_BATCH_SIZE);
    // A strict batch is refused together, with a separate message for each recipient.
    // A thrown or incomplete reply leaves the restaurant's claim in place.
    const sent = await sendMail({ messages, throwOnUncertainDelivery: true,
      idempotencyKey: `daily-digest/${row.restaurant_id}/${row.digest_day}/${offset}`,
      signal: AbortSignal.timeout(Math.min(1500, remaining)) });
    if (sent.sent) accepted += messages.length;
  }
  if (accepted === mails.length) return;
  if (accepted === 0) {
    const { error } = await context.db.from("restaurants").update({ digest_sent_for: null })
      .eq("id", row.restaurant_id).eq("digest_sent_for", row.digest_day);
    if (error) throw new Error("Could not release the refused digest", { cause: error });
  }
  throw new Error("Daily digest delivery incomplete");
}
