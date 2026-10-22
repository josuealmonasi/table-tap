import { checkClosedShifts } from "./money-shifts.mjs";
import { checkTerminalDeposits } from "./money-terminal.mjs";
import { DRAWER_ERA, time } from "./money-drawer-values.mjs";

const columns = {
  cash_shifts: "id, restaurant_id, currency, opened_at, closed_at, opening_amount, expected_cash, counted_cash, difference",
  cash_movements: "id, restaurant_id, shift_id, currency, kind, amount, created_at",
  payments: "id, restaurant_id, order_id, currency, method, actor_email, amount, tip, created_at, recorded_at, stripe_payment_intent, allocation_origin",
  refund_operations: "id, restaurant_id, currency, source, status, completed_at, payout_actor, amount, historical_log_id",
  user_logs: "id, restaurant_id, action, detail, created_at",
  orders: "id, restaurant_id, currency, status, cancelled_at, total, tip",
  terminal_deposits: "id, restaurant_id, currency, sales_day, expected, created_at, snapshot_at, payment_ids, return_ids, fee_pct",
  restaurants: "id, timezone, terminal_fee_pct",
  payment_allocations: "id, restaurant_id, payment_id",
  refund_allocations: "id, restaurant_id, allocation_id, operation_id, amount, tip",
  order_adjustments: "id, restaurant_id, order_id",
};

/** Read every source before reporting success: a failed page is never an empty table. */
export async function checkDrawer(db, all, { ok, bad, info = console.log }) {
  try {
    const rows = {};
    for (const [table, fields] of Object.entries(columns)) {
      const { data, error } = await all(() => db.from(table).select(fields));
      if (error || !Array.isArray(data)) throw new Error(`${table}: ${error?.message ?? "missing rows"}`);
      rows[table] = data;
    }
    // This is the projection the terminal screen reads, not the calculation
    // that wrote a deposit. Compare it to raw receipts so late money cannot
    // disappear from the screen while a signed manifest still adds up.
    const groups = new Map(rows.terminal_deposits.filter(d => time(d.created_at) >= time(DRAWER_ERA))
      .map(d => [JSON.stringify([d.restaurant_id, d.currency]), d]));
    rows.terminal_ledger = new Map();
    for (const [key, d] of groups) {
      const { data, error } = await all(() => db.rpc("terminal_deposit_ledger_v1", {
        p_restaurant: d.restaurant_id, p_currency: d.currency,
      }));
      if (error || !Array.isArray(data)) throw new Error(`terminal ledger ${key}: ${error?.message ?? "missing rows"}`);
      rows.terminal_ledger.set(key, data);
    }
    const reporters = { ok, bad, info };
    checkClosedShifts(rows, reporters);
    checkTerminalDeposits(rows, reporters);
  } catch (error) {
    bad(`cannot audit drawer/deposits: ${error.message}`);
  }
}
