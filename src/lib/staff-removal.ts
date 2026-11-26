import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidatePublicMenu } from "@/lib/public-menu-cache";
import { logEvent } from "@/lib/activity-log";
import { logDetail } from "@/lib/log-detail";
import { newCode } from "@/lib/accounts";
import { everyRow } from "@/lib/paged";

/**
 * What a removed member of staff may still hold: links they copied while they
 * worked here. The kitchen printer's link reads and clears tickets; a customer
 * account's link reads its statement. Removing the login does not take either
 * back (security sweep 2026-11-24), so the owner chooses at removal whether
 * to reset them.
 */

/** Replaces the printer's link; the old one stops working at once. */
export async function rotatePrintToken(restaurantId: string, actorEmail: string): Promise<string | null> {
  // 32 bytes, base64url: it survives a URL, a QR code and a printer's settings.
  const token = randomBytes(32).toString("base64url");
  const { error } = await createAdminClient().from("restaurants").update({ print_token: token }).eq("id", restaurantId);
  invalidatePublicMenu(restaurantId);
  if (error) return null;
  // Field and verb, never the value: the log is read by more people than settings.
  await logEvent({ restaurantId, actor: actorEmail, entity: "settings", action: "updated", detail: "print_token: rotated" });
  return token;
}

/** Marks that this person opened one account's link (its QR and code). */
export async function logAccountLinkViewed(restaurantId: string, actorEmail: string, accountId: string, name: string): Promise<void> {
  await logEvent({ restaurantId, actor: actorEmail, entity: "account", action: "opened", detail: logDetail({ name, link: accountId }) });
}

/** `email` as an ILIKE pattern that matches only itself, in any case. */
function exactCaseless(email: string): string {
  return email.trim().replace(/[\\%_]/g, c => `\\${c}`);
}

/**
 * The accounts whose link this person opened here, newest first. Every log
 * row is read, a page at a time: someone who opened a thousand links is the
 * one whose links most need resetting. The email is matched in any case:
 * the log holds the login's own (lowercase) address, and staff rows invited
 * before 2026-11-25 kept the address as it was typed.
 */
export async function accountsOpenedBy(restaurantId: string, email: string): Promise<string[]> {
  const db = createAdminClient();
  const rows = await everyRow<{ detail: string | null }>((from, to) => db.from("user_logs").select("detail")
    .eq("restaurant_id", restaurantId).ilike("actor_email", exactCaseless(email)).eq("entity", "account").eq("action", "opened")
    .order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to), "which accounts were opened");
  const ids = new Set<string>();
  for (const row of rows) {
    const id = /(?:^| )link=([0-9a-f-]{36})(?: |$)/.exec(String(row.detail ?? ""))?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** New codes for these accounts of this restaurant; the old QR links stop working. */
export async function rotateAccountCodes(
  restaurantId: string, accountIds: string[], actorEmail: string,
): Promise<{ id: string; name: string; code: string }[]> {
  const db = createAdminClient();
  const done: { id: string; name: string; code: string }[] = [];
  for (const id of accountIds) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCode();
      const { data, error } = await db.from("customer_accounts").update({ code })
        .eq("id", id).eq("restaurant_id", restaurantId).select("id, name").maybeSingle();
      if (!error) {
        if (data) {
          done.push({ id: data.id as string, name: data.name as string, code });
          await logEvent({ restaurantId, actor: actorEmail, entity: "account", action: "updated", detail: logDetail({ name: data.name as string, code: "new" }) });
        }
        break;
      }
      if (error.code !== "23505") throw new Error(`Could not reset an account link: ${error.message}`);
    }
  }
  return done;
}
