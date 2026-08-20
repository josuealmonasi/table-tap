import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { isAllowedTimeZone } from "@/lib/timezones";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/activity-log";
import { actingManager } from "@/lib/api-guard";
import { frozenBlocks } from "@/lib/plan-guard";
import { isOwnStorageUrl } from "@/lib/images";

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
  "cover_url",
  "cover_enabled",
  "logo_url",
  "allow_pay_later",
  "allow_counter_payment",
  "badges_enabled",
]);
// A manager runs the floor, so they decide whether the floor is being told
// about work waiting — the same reasoning that gives them the kill switch.
const MANAGER_FIELDS = new Set([
  "tax_pct",
  "tax_show_breakdown",
  "accepting_orders",
  "badges_enabled",
]);

// POST /api/settings — owner or manager updates restaurant settings, with the
// allowed field set enforced by role. Writes with the secret key after the
// membership check (managers can't update `restaurants` under RLS).
export async function POST(req: NextRequest) {
  const actor = await actingManager();
  if (!actor) return await apiError("apiErr.forbidden", 403);

  // Frozen with the rest of the desk work. The line `locked` draws is between
  // what an owner does at a desk — settings, staff, promotions — and what the
  // floor does mid-service: taking payment, moving orders, discounting a table
  // in front of the diners sitting at it. The second kind keeps working, and
  // so does everything the diner touches.
  const frozen = await frozenBlocks(actor.restaurantId);
  if (frozen) return frozen;

  const body = (await req.json()) as Record<string, unknown>;
  const allowed = actor.role === "owner" ? OWNER_FIELDS : MANAGER_FIELDS;

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

  // Only a zone the selector actually offers. An arbitrary string would make
  // Intl throw on every customer page load, and there's no reason to store one.
  if ("timezone" in update && !isAllowedTimeZone(String(update.timezone))) {
    return await apiError("apiErr.badTimezone");
  }

  // The cover must live in our own storage, not wherever the client says. An
  // arbitrary URL would be rendered to every diner who scans the QR code, and
  // would leak their IP to whoever is hosting it. Clearing it is allowed.
  for (const field of ["cover_url", "logo_url"] as const) {
    if (field in update && update[field] && !isOwnStorageUrl(String(update[field]))) {
      return await apiError("apiErr.badCover", 400);
    }
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
    .eq("id", actor.restaurantId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Named fields only: a log line reading "settings updated" answers nothing,
  // and the values themselves are what an owner comes back to check.
  await logEvent({
    restaurantId: actor.restaurantId,
    actor: actor.email,
    entity: "settings",
    action:
      "accepting_orders" in update
        ? update.accepting_orders
          ? "resumed"
          : "paused"
        : "updated",
    detail: Object.entries(update)
      .map(([k, v]) => `${k}: ${typeof v === "string" && v.length > 30 ? "…" : v}`)
      .join(", "),
  });
  return NextResponse.json({ ok: true });
}
