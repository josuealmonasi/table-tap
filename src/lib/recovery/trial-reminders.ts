import { sendMail } from "@/lib/mail";
import { isLocale } from "@/lib/i18n";
import { runBatch, type PendingItem, type RecoveryContext, type Snapshot } from "./job";
import { trialReminderMail } from "./trial-reminder-mail";

interface Due extends PendingItem { owner_id: string | null; trial_ends_at: string }

/**
 * Three days before a free trial ends, the owner is emailed once: when it ends,
 * that they then move to Carta, and a link to choose a plan. Until now the only
 * warning was a banner inside a dashboard an owner may not open that week.
 * Idempotent per trial end: the key and `trial_reminded_for` are both that date.
 */
export async function recoverTrialReminders(context: RecoveryContext) {
  const { db } = context;
  return runBatch("trial reminders", context, async (limit, offset = 0) => {
    const result = await db.from("trial_reminders_due").select("restaurant_id, owner_id, trial_ends_at, created_at", { count: "exact" })
      .order("created_at").order("restaurant_id").range(offset, offset + limit - 1).returns<Due[]>();
    return result as Snapshot<Due>;
  }, async row => {
    if (!row.owner_id) throw new Error("owner unavailable");
    const { data: plan, error: planError } = await db.from("restaurants").select("plan").eq("id", row.restaurant_id).maybeSingle();
    if (planError || !plan) throw new Error("restaurant unavailable");
    const { data, error } = await db.auth.admin.getUserById(row.owner_id);
    if (error || !data.user?.email) throw new Error("owner email unavailable");
    const saved = data.user.user_metadata?.locale;
    const link = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://tabletap.shop").replace(/\/$/, "")}/dashboard/plan`;
    const mail = trialReminderMail({ plan: plan.plan as string, endsAt: row.trial_ends_at, link }, isLocale(saved) ? saved : undefined);
    const sent = await sendMail({ to: data.user.email, ...mail, idempotencyKey: `trial-reminder/${row.restaurant_id}/${row.trial_ends_at}`,
      signal: AbortSignal.timeout(Math.min(1500, Math.max(1, context.deadline - Date.now()))) });
    if (!sent.sent) throw new Error("mail failed");
    const marked = await db.from("restaurants").update({ trial_reminded_for: row.trial_ends_at })
      .eq("id", row.restaurant_id).eq("trial_ends_at", row.trial_ends_at);
    if (marked.error) throw new Error("reminder record unavailable");
    return true;
  }, "trial_ends_at - 3 days");
}
