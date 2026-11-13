import type { DepositRecord, TerminalPayment } from "@/lib/terminal";

export const saleDay = "2026-11-09";
export const returnDay = "2026-11-10";
export const nextDay = "2026-11-11";
export const sale = (id = "sale", day = saleDay, amount = 100): TerminalPayment => ({
  id, amount, tip: 0, created_at: `${day}T18:00:00Z`, recorded_at: `${day}T18:00:00Z`,
});
export const returned: TerminalPayment = {
  ...sale("return:x", saleDay, 40), payment_id: "sale", returned_at: `${returnDay}T18:00:00Z`,
};
export const mark = (day = saleDay, expected = 96.5, payment_ids = ["sale"], return_ids: string[] = []): DepositRecord => ({
  sales_day: day, currency: "MXN", expected, received: expected, fee_pct: 3.5,
  payment_ids, return_ids, snapshot_at: `${day}T20:00:00Z`, created_at: `${day}T20:00:00Z`,
  note: null, recorded_by: "manager",
});
