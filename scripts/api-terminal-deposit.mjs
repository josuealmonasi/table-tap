import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";
import { MARK } from "./api-fixtures.mjs";

/** Hold a receipt uncommitted while the HTTP mark tries to take its money lock. */
export function terminalDepositRace() {
  const day = "2002-02-02";
  const at = `${day}T18:00:00Z`;
  const orders = [randomUUID(), randomUUID()];
  const receipts = [randomUUID(), randomUUID()];
  const started = new Date().toISOString();
  const note = `${MARK} deposit-race ${randomUUID()}`;
  let holder; let observer; let release; let releaseError; let waited = false;
  const checked = async query => {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data;
  };
  return {
    name: "POST /api/terminal/deposits (I3: a concurrent MX$50 receipt belongs to the snapshot)",
    as: "manager", method: "POST", path: "/api/terminal/deposits", expect: [200],
    arrange: async f => {
      const r = f.restaurant.id;
      const clean = async () => {
        await release;
        if (holder) { await holder.query("rollback").catch(() => {}); await holder.end(); }
        if (observer) await observer.end();
        await checked(f.admin.from("terminal_deposits").delete().eq("restaurant_id", r).eq("note", note));
        await checked(f.admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "terminal").eq("actor_email", "demo-manager@tabletap.dev").gte("created_at", started).like("detail", `%${day}%`));
        await checked(f.admin.from("payments").delete().eq("restaurant_id", r).in("id", receipts));
        await checked(f.admin.from("print_jobs").delete().in("order_id", orders));
        await checked(f.admin.from("orders").delete().eq("restaurant_id", r).in("id", orders));
      };
      try {
        const existing = await checked(f.admin.from("terminal_deposits").select("id").eq("restaurant_id", r).eq("sales_day", day));
        if (existing.length) throw new Error("the race's isolated day already has a deposit");
        await checked(f.admin.from("orders").insert(orders.map((id, i) => ({
          id, restaurant_id: r, items: [{ itemId: f.dish.id, name: f.dish.name, price: i ? 50 : 100, qty: 1, mods: {} }],
          subtotal: i ? 50 : 100, total: i ? 50 : 100, tip: 0, tax_pct: 0, service_fee: 0, discount: 0,
          status: "completed", paid: true, pay_method: "card", currency: f.restaurant.currency, note, created_at: at,
        }))));
        await checked(f.admin.from("payments").insert({ id: receipts[0], restaurant_id: r, order_id: orders[0],
          amount: 100, method: "card", currency: f.restaurant.currency, actor_email: "demo-manager@tabletap.dev", created_at: at }));
        const options = { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } };
        if (!options.connectionString) throw new Error("DATABASE_URL is required for the deposit race");
        holder = new pg.Client(options); observer = new pg.Client(options);
        await holder.connect(); await observer.connect();
        await holder.query("begin");
        await holder.query("set local idle_in_transaction_session_timeout = '20s'");
        await holder.query("select public.lock_restaurant_money($1)", [r]);
        await holder.query(`insert into payments(id, restaurant_id, order_id, amount, method, currency, actor_email, created_at)
          values($1, $2, $3, 50, 'card', $4, 'demo-manager@tabletap.dev', $5)`, [receipts[1], r, orders[1], f.restaurant.currency, at]);
        return clean;
      } catch (error) { await clean(); throw error; }
    },
    body: f => {
      release = (async () => {
        // Observe the HTTP transaction waiting, rather than guess how long the
        // server takes. The timeout also releases an old, unlocked implementation.
        for (let n = 0; n < 100; n++) {
          const { rows } = await observer.query(`select exists(select 1 from pg_stat_activity
            where $1 = any(pg_blocking_pids(pid)) and query like '%record_terminal_deposit_v1%') waiting`, [holder.processID]);
          if (rows[0].waiting) { waited = true; break; }
          await pause(100);
        }
        await holder.query("commit");
      })().catch(error => { releaseError = error; });
      return { day, currency: f.restaurant.currency, received: "150", note };
    },
    effect: async f => {
      await release;
      if (releaseError) throw releaseError;
      const [deposit] = await checked(f.admin.from("terminal_deposits")
        .select("expected, snapshot_at, payment_ids, return_ids, fee_pct").eq("restaurant_id", f.restaurant.id).eq("note", note));
      const money = await checked(f.admin.from("payments").select("id, amount").eq("restaurant_id", f.restaurant.id).in("id", receipts));
      const gross = money.reduce((n, p) => n + Number(p.amount), 0);
      const expected = Math.round((gross - Math.round(gross * Number(deposit?.fee_pct)) / 100) * 100) / 100;
      return waited && gross === 150 && deposit?.snapshot_at && deposit.payment_ids.length === 2
        && receipts.every(id => deposit.payment_ids.includes(id)) && Array.isArray(deposit.return_ids)
        && Number(deposit.expected) === expected || `the mark lost concurrent money: ${JSON.stringify(deposit)}`;
    },
  };
}
