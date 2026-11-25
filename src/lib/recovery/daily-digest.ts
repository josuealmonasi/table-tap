import { createHash } from "node:crypto";
import { digestStopToken } from "@/lib/digest-stop-token";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
import { MAIL_BATCH_SIZE, sendMail } from "@/lib/mail";
import { everyRow } from "@/lib/paged";
import { readDigestFigures, type DigestFigures } from "./digest-figures";
import { digestMail } from "./digest-mail";
import { hasTime, runBatch, type PendingItem, type RecoveryContext } from "./job";

interface Due extends PendingItem {
  owner_id: string | null;
  name: string;
  currency: string;
  timezone: string;
  digest_day: string;
  retry: boolean;
}

interface Batch {
  id: string;
  address_keys: string[];
}

interface Mailbox {
  address_key: string;
  email: string;
  user_id: string | null;
  is_owner: boolean;
  locale: string | null;
  preference_version: string | null;
  stop_token: string | null;
}

type Db = RecoveryContext["db"];

export async function recoverDailyDigests(context: RecoveryContext) {
  const { db } = context;
  return runBatch<Due>("daily digest", context, (limit, offset = 0) => db.from("daily_digests_due_v2")
    .select("restaurant_id, owner_id, name, currency, timezone, digest_day, created_at, retry", { count: "exact" })
    .order("created_at").order("restaurant_id").order("digest_day").range(offset, offset + limit - 1).returns<Due[]>(),
  row => recoverReport(context, row), "restaurant local 07:00");
}

async function recoverReport(context: RecoveryContext, row: Due): Promise<boolean> {
  const { db } = context;
  // The report's scheduled local morning stays fixed when a retry crosses midnight.
  const figures = await readDigestFigures(db, row, new Date(row.created_at));
  if (!hasTime(context)) return false;

  if (!row.retry) {
    if (!figures) return false;
    const { error } = await db.rpc("claim_daily_digest_v2", {
      p_restaurant: row.restaurant_id, p_day: row.digest_day, p_owner: row.owner_id,
      p_currency: row.currency, p_timezone: row.timezone, p_created_at: row.created_at, p_batch_size: MAIL_BATCH_SIZE,
    });
    if (error) throw new Error("Could not claim the daily digest", { cause: error });
  }

  const pending = await everyRow<Batch>((a, b) => db.from("daily_digest_batches")
    .select("id, address_keys").eq("restaurant_id", row.restaurant_id).eq("digest_day", row.digest_day)
    .eq("status", "pending").order("batch_number").range(a, b), "pending digest batches");
  let processed = false;
  let refused = false;
  for (const batch of pending) {
    if (!hasTime(context)) break;
    if (!await claimBatch(db, batch.id)) continue;
    processed = true;
    if (!figures) {
      await finishBatch(db, batch.id, "skipped");
      continue;
    }
    if (!await deliverBatch(context, row, figures, batch)) refused = true;
  }
  if (refused) throw new Error("Daily digest batch refused");
  return processed;
}

async function claimBatch(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from("daily_digest_batches").update({ status: "submitting" })
    .eq("id", id).eq("status", "pending").select("id");
  if (error) throw new Error("Could not claim the daily digest batch", { cause: error });
  return Boolean(data?.length);
}

async function finishBatch(
  db: Db, id: string, status: "pending" | "accepted" | "uncertain" | "skipped", addressKeys: string[] = [],
): Promise<void> {
  const { error } = await db.from("daily_digest_batches").update({ status, address_keys: addressKeys })
    .eq("id", id).eq("status", "submitting");
  if (error) throw new Error("Could not record the digest batch outcome", { cause: error });
}

async function deliverBatch(context: RecoveryContext, row: Due, figures: DigestFigures, batch: Batch): Promise<boolean> {
  const { db } = context;
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://tabletap.shop";
  const { messages, keys } = await prepareBatch(db, row, figures, batch, origin).catch(async error => {
    // No provider request was made. It is safe to release the whole batch.
    await finishBatch(db, batch.id, "pending", batch.address_keys);
    throw error;
  });
  if (!messages.length) {
    await finishBatch(db, batch.id, "skipped");
    return true;
  }
  const remaining = context.deadline - Date.now();
  if (remaining <= 0) {
    await finishBatch(db, batch.id, "pending", keys);
    return true;
  }

  // If this process dies after submitting, the durable claim rules out replay.
  const payloadKey = createHash("sha256").update(JSON.stringify(messages)).digest("hex");
  const result = await sendMail({ messages, throwOnUncertainDelivery: true,
    idempotencyKey: `daily-digest/${batch.id}/${payloadKey}`, signal: AbortSignal.timeout(Math.min(1500, remaining)),
  }).catch(async error => {
    await finishBatch(db, batch.id, "uncertain");
    throw error;
  });
  if (result.sent) await finishBatch(db, batch.id, "accepted");
  else await finishBatch(db, batch.id, "pending", keys);
  return result.sent;
}

async function prepareBatch(db: Db, row: Due, figures: DigestFigures, batch: Batch, origin: string) {
  const { data, error } = await db.from("daily_digest_mailboxes")
    .select("address_key, email, user_id, is_owner, locale, preference_version, stop_token")
    .eq("restaurant_id", row.restaurant_id).in("address_key", batch.address_keys)
    .order("address_key").returns<Mailbox[]>();
  if (error) throw new Error("Could not recheck the daily digest recipients", { cause: error });

  const dashboard = new URL("/dashboard", origin).href;
  const mailboxes = data ?? [];
  const messages = mailboxes.map(person => {
    const locale = isLocale(person.locale) ? person.locale : DEFAULT_LOCALE;
    const guest = person.user_id === null;
    const token = person.user_id && person.preference_version
      ? digestStopToken({ restaurantId: row.restaurant_id, userId: person.user_id, addressKey: person.address_key,
        version: person.preference_version, locale })
      : person.stop_token;
    if (!token) throw new Error("Digest mailbox is missing its stop token");
    const path = guest ? "stop" : "opt-out";
    return { to: person.email, ...digestMail(figures, { ...row, locale, owner: person.is_owner, guest, dashboard,
      stop: new URL(`/digest/${path}?t=${token}`, origin).href,
      oneClick: new URL(`/api/digest/${path}?t=${token}`, origin).href }) };
  });
  return { messages, keys: mailboxes.map(person => person.address_key) };
}
