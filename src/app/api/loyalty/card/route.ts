import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { jsonBody } from "@/lib/json-body";
import { clientIp, isRateLimited } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlan } from "@/lib/plan-server";
import { newCode } from "@/lib/loyalty/code";
import { cardFace } from "@/lib/loyalty/face";
import { qrGrid } from "@/lib/loyalty/qr-grid";
import { loyaltyOn, programOf } from "@/lib/loyalty/server";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/loyalty/card  { restaurantId } — a new visit card, for the diner
// who just paid and said yes.
//
// Public: a card names nobody and is worth nothing until staff stamp it, so
// there is no account to check — but it is limited per address, so nobody
// fills the table with empty cards. Refused where `loyaltyOn` says no, the
// same function that decides whether staff see the scanner: a card nobody
// could stamp is a promise the restaurant would not keep.
//
// Answers with the card's face and its QR as a grid of modules, so the phone
// draws the image itself and the QR library never ships to it.
export async function POST(req: NextRequest) {
  if (await isRateLimited(`loyalty-card:${clientIp(req)}`, 5, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const body = await jsonBody<{ restaurantId?: unknown }>(req);
  const restaurantId = typeof body?.restaurantId === "string" && UUID.test(body.restaurantId) ? body.restaurantId : null;
  if (!restaurantId) return await apiError("apiErr.invalidRequest", 400);

  const plan = await getPlan(restaurantId);
  if (!(await loyaltyOn(restaurantId, plan?.limits ?? null))) return await apiError("apiErr.loyaltyOff", 409);
  const program = await programOf(restaurantId);
  if (!program) return await apiError("apiErr.loyaltyOff", 409);

  const db = createAdminClient();
  const { data: restaurant } = await db
    .from("restaurants").select("name, logo, logo_url").eq("id", restaurantId).maybeSingle();
  if (!restaurant) return await apiError("apiErr.invalidRequest", 400);

  // The card keeps the ladder it starts with, so an owner editing the program
  // never moves a finish line a diner is already walking towards. A step with
  // no reward cannot be kept (the database refuses it); such a card reads the
  // program's reward instead, as every card did before the ladder.
  const steps = program.steps.every(s => s.reward) ? program.steps : null;

  // Sixty random bits collide essentially never; three tries is for "never".
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = newCode();
    const { error } = await db
      .from("loyalty_cards").insert({ restaurant_id: restaurantId, code, goal: program.goal, steps });
    if (!error) {
      const face = cardFace(restaurant, { code, progress: 0, ladder: program.steps }, req.nextUrl.origin);
      return NextResponse.json({ code, face, qr: qrGrid(face.qrPayload) });
    }
    if (error.code !== "23505") {
      console.error("loyalty card create failed:", error.message);
      return await apiError("apiErr.generic", 500);
    }
  }
  return await apiError("apiErr.generic", 500);
}
