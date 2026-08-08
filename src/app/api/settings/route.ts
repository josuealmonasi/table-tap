import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isKnownTimeZone } from "@/lib/timezones";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMembership, MANAGES } from "@/lib/membership";

export const runtime = "nodejs";

// Fields each role may change. Identity + currency + service fee are the
// owner's; managers get the operational controls (tax + order pausing).
const OWNER_FIELDS = new Set([
  "name",
  "logo",
  "tagline",
  "currency",
  "timezone",
  "service_pct",
  "service_enabled",
  "tax_pct",
  "tax_show_breakdown",
  "accepting_orders",
]);
const MANAGER_FIELDS = new Set(["tax_pct", "tax_show_breakdown", "accepting_orders"]);

// POST /api/settings — owner or manager updates restaurant settings, with the
// allowed field set enforced by role. Writes with the secret key after the
// membership check (managers can't update `restaurants` under RLS).
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const membership = await getMembership(supabase);
  if (!membership || !MANAGES(membership.role)) {
    return await apiError("apiErr.forbidden", 403);
  }

  const body = (await req.json()) as Record<string, unknown>;
  const allowed = membership.role === "owner" ? OWNER_FIELDS : MANAGER_FIELDS;

  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!allowed.has(key)) {
      return await apiError("apiErr.settingNotAllowed", 403);
    }
    update[key] = value;
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true });
  }

  // Only a real IANA zone: schedules are evaluated against it, and an
  // unknown name would make Intl throw on every customer page load.
  if ("timezone" in update && !isKnownTimeZone(String(update.timezone))) {
    return await apiError("apiErr.badTimezone");
  }

  // Clamp the numeric ranges the DB constraints also enforce.
  if ("service_pct" in update) {
    update.service_pct = Math.min(30, Math.max(0, Number(update.service_pct) || 0));
  }
  if ("tax_pct" in update) {
    update.tax_pct = Math.min(100, Math.max(0, Number(update.tax_pct) || 0));
  }

  const { error } = await createAdminClient()
    .from("restaurants")
    .update(update)
    .eq("id", membership.restaurant.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
