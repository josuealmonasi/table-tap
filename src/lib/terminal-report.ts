import { createAdminClient } from "@/lib/supabase/admin";
import { everyRow } from "@/lib/paged";
import { readTerminal, type TerminalView } from "@/lib/terminal-server";
import type { DepositRecord } from "@/lib/terminal";

export interface UnverifiedDeposit extends DepositRecord { id: string }
export interface TerminalReport {
  currencies: { currency: string; view: TerminalView }[];
  unverified: UnverifiedDeposit[];
}

/** Keep past currencies visible without adding their amounts together. */
export async function readTerminalReport(restaurantId: string, timeZone: string, currency: string): Promise<TerminalReport> {
  const now = new Date();
  const [views, unverified] = await Promise.all([
    Promise.all(["MXN", "USD"].map(async c => ({ currency: c, view: await readTerminal(restaurantId, timeZone, now, c) }))),
    everyRow<UnverifiedDeposit>((a, b) => createAdminClient().from("terminal_deposits")
      .select("id, sales_day, currency, expected, received, note, recorded_by, created_at")
      .eq("restaurant_id", restaurantId).is("currency", null).order("id").range(a, b), "deposits needing currency verification"),
  ]);
  return { currencies: views.filter(v => v.currency === currency || v.view.days.length > 0), unverified };
}
