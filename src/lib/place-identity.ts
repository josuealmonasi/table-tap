import { createAdminClient } from "@/lib/supabase/admin";
import { ticketAddress } from "@/lib/ticket-place";

/** Who a diner is paying: the legal name and where the place is. Nothing fiscal beyond that. */
export interface PlaceIdentity {
  name: string;
  address: string;
}

interface IdentityRow {
  name: string; legal_name: string | null;
  address_street: string | null; address_ext_number: string | null; address_int_number: string | null;
  address_colonia: string | null; address_postal_code: string | null; address_municipality: string | null;
  address_state: string | null;
}

/** Razón social when the owner set one, else the trade name; the address as the ticket prints it. */
export function placeIdentity(row: IdentityRow): PlaceIdentity {
  return { name: row.legal_name?.trim() || row.name, address: ticketAddress(row).join(", ") };
}

/**
 * Read server-side with the secret key, exactly as the ticket does: these
 * columns are not granted to the anonymous role and must stay that way. Only
 * the two derived strings reach the browser, never the row, the RFC or the regime.
 * A failed read hides the block rather than the menu.
 */
export async function loadPlaceIdentity(restaurantId: string): Promise<PlaceIdentity | null> {
  const { data, error } = await createAdminClient().from("restaurants").select(
    "name, legal_name, address_street, address_ext_number, address_int_number, "
    + "address_colonia, address_postal_code, address_municipality, address_state",
  ).eq("id", restaurantId).maybeSingle();
  if (error || !data) return null;
  return placeIdentity(data as unknown as IdentityRow);
}
