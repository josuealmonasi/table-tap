/** A clean seed must not change its sales or stock when cron has nothing to recover. */
async function snapshot(fx) {
  const state = {};
  for (const table of ["orders", "payments", "menu_items", "refund_operations", "refunds_due"]) {
    const { data, error } = await fx.admin.from(table).select("*").eq("restaurant_id", fx.restaurant.id).order("id");
    if (error) throw new Error(`Could not snapshot ${table}: ${error.message}`);
    state[table] = data;
  }
  return JSON.stringify(state);
}

export function recoveryCases() {
  return [
    { name: "GET /api/cron/recover (no secret refused)", path: "/api/cron/recover", method: "GET",
      as: "owner", headers: { authorization: "" }, expect: [401], expectError: /Unauthorized/ },
    { name: "GET /api/cron/recover (cron secret and clean seed)", path: "/api/cron/recover", method: "GET",
      as: "diner", expect: [200],
      headers: () => ({ authorization: `Bearer ${process.env.CRON_SECRET}`, cookie: "" }),
      arrange: async fx => {
        if (!process.env.CRON_SECRET) throw new Error("Set CRON_SECRET in the dev environment for the authorized recovery case");
        fx.recoveryBefore = await snapshot(fx);
        return async () => { delete fx.recoveryBefore; };
      },
      check: async (answer, fx) => {
        for (const name of ["stock", "refunds", "fees", "subscriptions"]) {
          const job = answer.jobs?.[name];
          if (!job || !Number.isInteger(job.done) || !Number.isInteger(job.pending) || job.failed !== 0
            || !(job.oldest_pending_age_seconds === null || Number.isFinite(job.oldest_pending_age_seconds))) {
            return `missing or unhealthy ${name} counts`;
          }
        }
        return await snapshot(fx) === fx.recoveryBefore || "recovery changed the clean seed's sales or stock";
      } },
  ];
}
