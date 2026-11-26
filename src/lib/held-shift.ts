import type { createAdminClient } from "@/lib/supabase/admin";
import type { PosSaleBody } from "@/lib/pos-sale";

/** A shift a manager may record a held cash sale in. */
export interface HeldShiftOption { id: string; opened_at: string; closed_at: string | null }

/**
 * The shifts a manager chooses between when approving a held cash sale that
 * names the shift its till had open (bl39 finding 2): that shift, and the one
 * open now. Null for a receipt that names none — card sales, and cash sales
 * from older tills, which keep their device time.
 */
export interface HeldShiftChoice { taken: HeldShiftOption | null; open: HeldShiftOption | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function heldShiftChoice(db: ReturnType<typeof createAdminClient>, restaurantId: string, body: PosSaleBody): Promise<HeldShiftChoice | null> {
  if (body.method !== "cash" || body.cashShiftId == null) return null;
  const claimed = typeof body.cashShiftId === "string" && UUID.test(body.cashShiftId) ? body.cashShiftId : null;
  const shifts = () => db.from("cash_shifts").select("id, opened_at, closed_at").eq("restaurant_id", restaurantId);
  const [taken, open] = await Promise.all([
    claimed ? shifts().eq("id", claimed).maybeSingle() : Promise.resolve({ data: null, error: null }),
    shifts().is("closed_at", null).maybeSingle(),
  ]);
  if (taken.error || open.error) throw new Error("the held sale's shifts");
  return { taken: (taken.data as HeldShiftOption | null) ?? null, open: (open.data as HeldShiftOption | null) ?? null };
}
