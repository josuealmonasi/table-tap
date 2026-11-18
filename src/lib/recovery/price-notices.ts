import { sendMail } from "@/lib/mail";
import { runBatch, type PendingItem, type RecoveryContext, type Snapshot } from "./job";
import { priceNoticeMail } from "./price-notice-mail";

interface Notice extends PendingItem {
  change_id: string;
  attempts: number;
  mail_body: { to: string; subject: string; text: string; html: string } | null;
  plan_price_changes: { created_at: string; new_monthly_price: number; effective_at: string };
  restaurants: { owner_id: string | null; stripe_subscription_id: string | null };
}

export async function recoverPriceNotices(context: RecoveryContext) {
  const { db, client } = context;
  return runBatch("price notices", context, async (limit, offset = 0) => {
    const result = await db.from("plan_price_notices")
      .select("change_id, restaurant_id, created_at, attempts, mail_body, plan_price_changes!inner(created_at, new_monthly_price, effective_at), restaurants!inner(owner_id, stripe_subscription_id)", { count: "exact" })
      .is("sent_at", null).order("created_at").order("change_id").order("restaurant_id").range(offset, offset + limit - 1).returns<Notice[]>();
    return result as Snapshot<Notice>;
  }, async row => {
    let failure = "notice unavailable";
    try {
      let body = row.mail_body;
      if (!body) {
        const { owner_id: owner, stripe_subscription_id: subscription } = row.restaurants;
        if (!owner) { failure = "owner unavailable"; throw new Error(failure); }
        const { data, error } = await db.auth.admin.getUserById(owner);
        if (error || !data.user?.email) { failure = "owner email unavailable"; throw new Error(failure); }
        let current: number | undefined;
        if (subscription) {
          const sub = await client.subscriptions.retrieve(subscription);
          const price = sub.items.data.length === 1 ? sub.items.data[0].price : null;
          if (!price || price.currency !== "mxn" || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1 || price.unit_amount == null) {
            failure = "subscription price unavailable"; throw new Error(failure);
          }
          current = price.unit_amount / 100;
        }
        const link = `${(process.env.NEXT_PUBLIC_SITE_URL ?? "https://tabletap.shop").replace(/\/$/, "")}/dashboard/plan`;
        body = { to: data.user.email, ...priceNoticeMail({ current, next: row.plan_price_changes.new_monthly_price,
          effectiveAt: row.plan_price_changes.effective_at, link }) };
        // Save the exact request first: a lost reply must not change its body.
        const kept = await db.from("plan_price_notices").update({ mail_body: body })
          .eq("change_id", row.change_id).eq("restaurant_id", row.restaurant_id).is("sent_at", null).is("mail_body", null).select("change_id");
        if (kept.error || kept.data?.length !== 1) throw new Error("notice snapshot unavailable");
      }
      const sent = await sendMail({ ...body, idempotencyKey: `price-notice/${row.change_id}/${row.restaurant_id}`,
        signal: AbortSignal.timeout(Math.min(1500, Math.max(1, context.deadline - Date.now()))) });
      if (!sent.sent) { failure = "mail failed"; throw new Error(failure); }
      const saved = await db.from("plan_price_notices").update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("change_id", row.change_id).eq("restaurant_id", row.restaurant_id).is("sent_at", null);
      if (saved.error) throw new Error("delivery record unavailable");
      return true;
    } catch {
      const saved = await db.from("plan_price_notices").update({ attempts: row.attempts + 1, last_error: failure })
        .eq("change_id", row.change_id).eq("restaurant_id", row.restaurant_id).is("sent_at", null);
      if (saved.error) throw new Error("notice failure record unavailable");
      throw new Error(failure);
    }
  }, "created_at");
}
