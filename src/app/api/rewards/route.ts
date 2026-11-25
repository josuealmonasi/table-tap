import { cardEmailPending, emailForRole } from "@/lib/loyalty/card-email";
import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientKey, isRateLimited } from "@/lib/rate-limit";
import { normalizeCode } from "@/lib/loyalty/code";
import { hashOwnerSecret, keepEmailOwnerSecret, keepOwnerSecret, matchesOwnerSecret, readOwnerSecret } from "@/lib/loyalty/owner-secret";
import { cardFace } from "@/lib/loyalty/face";
import { qrGrid } from "@/lib/loyalty/qr-grid";
import { CARD_COLUMNS, cardState, type CardRow } from "@/lib/loyalty/server";
import { ladderOf, sameLadder } from "@/lib/loyalty/ladder";

export const runtime = "nodejs";

// GET /api/rewards?c=K7QM3XW9TB4R — where a loyalty card stands, for whoever
// holds its printed code.
//
// It answers with what the card itself would show and nothing more — the
// restaurant, the progress, the rewards, the days of the last visit and of each
// reward spent. Never who stamped it, never the card's internal id.
export async function GET(req: NextRequest) {
  // Sixty bits cannot be walked, but a page that answers "no such card" as fast
  // as it is asked is still an oracle. Ten looks a minute is plenty for a
  // person with a card in their hand.
  if (await isRateLimited(`rewards:${clientKey(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }

  const code = normalizeCode(req.nextUrl.searchParams.get("c") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);

  const db = createAdminClient();
  const { data: card, error } = await db
    .from("loyalty_cards")
    .select(`${CARD_COLUMNS}, restaurant_id, created_at, ladder_at, saved_at, email, owner_secret_hash, pending_email_expires_at`)
    .eq("code", code)
    .maybeSingle<CardRow & {
      restaurant_id: string; created_at: string; ladder_at: string; saved_at: string;
      owner_secret_hash: string | null; pending_email_expires_at: string | null;
    }>();
  if (error) {
    console.error("rewards: card read failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  if (!card) return await apiError("rewards.notFound", 404);

  const [restaurant, program, lastVisit, spent] = await Promise.all([
    db.from("restaurants").select("name, logo, logo_url").eq("id", card.restaurant_id).single(),
    db.from("loyalty_programs").select("active, reward, goal, steps").eq("restaurant_id", card.restaurant_id).maybeSingle(),
    db.from("loyalty_visits").select("visit_day").eq("card_id", card.id)
      .order("visit_day", { ascending: false }).limit(1).maybeSingle(),
    db.from("loyalty_redemptions").select("reward, created_at").eq("card_id", card.id)
      .order("created_at", { ascending: false }).limit(20),
  ]);
  const failed = [restaurant, program, lastVisit, spent].find(r => r.error);
  if (failed?.error || !restaurant.data) {
    console.error("rewards: read failed:", failed?.error?.message ?? "no restaurant");
    return await apiError("apiErr.generic", 500);
  }
  const state = await cardState(card, program.data?.reward ?? "");
  if (!state) return await apiError("apiErr.generic", 500);

  // The card's own face, so a diner who lost the image can save it again from
  // here — drawn from the same face as the first one, to the same QR.
  const face = cardFace(restaurant.data, { code, ...state }, req.nextUrl.origin);

  // A card keeps the rewards its round started with (terms), so rewards the
  // restaurant added since are the next round's. Said, rather than left for
  // the diner to wonder why the page and the menu disagree.
  const programLadder = program.data
    ? ladderOf(program.data.steps, program.data.goal, program.data.reward)
    : [];
  const upcoming =
    program.data?.active && programLadder.some(s => s.reward.trim()) && !sameLadder(programLadder, state.ladder)
      ? programLadder.map(s => ({ visits: s.visits, reward: s.reward.trim() }))
      : null;

  const secret = readOwnerSecret(req, code);
  const owned = matchesOwnerSecret(secret, card.owner_secret_hash);
  const response = NextResponse.json({
    canDelete: owned,
    ...(owned ? { emailPending: cardEmailPending(card.pending_email_expires_at) } : {}),
    // The address this card's tickets go to, masked: a waiter who scanned
    // the card holds its code too, and the floor never sees an address whole
    // (Codex review of #622). The diner retypes it to change it.
    email: emailForRole((card as { email?: string | null }).email ?? null, false),
    face,
    qr: qrGrid(face.qrPayload),
    restaurant: { id: card.restaurant_id, ...restaurant.data },
    upcoming,
    // The picture lists the card's rewards: saved before they last changed,
    // it shows rewards the card no longer has.
    saveAgain: new Date(card.ladder_at) > new Date(card.saved_at),
    // Paused means no new visits, not that the card stopped meaning anything:
    // a reward already earned is still honoured.
    active: program.data?.active ?? false,
    standing: face.standing,
    memberSince: card.created_at.slice(0, 10),
    lastVisit: lastVisit.data?.visit_day ?? null,
    redeemed: (spent.data ?? []).map(r => ({ day: r.created_at.slice(0, 10), reward: r.reward })),
  }, { headers: { "Cache-Control": "private, no-store" } });
  // Phones with the original rewards-only cookie can edit from this screen.
  return owned && secret ? keepEmailOwnerSecret(response, code, secret) : response;
}

// Anyone with the printed code can save the picture. Only the phone already
// holding the deletion key can renew its cookie when saving again.
export async function PATCH(req: NextRequest) {
  if (await isRateLimited(`rewards:${clientKey(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }
  const code = normalizeCode(req.nextUrl.searchParams.get("c") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);

  const { data: card, error } = await createAdminClient()
    .from("loyalty_cards")
    .update({ saved_at: new Date().toISOString() })
    .eq("code", code)
    .select("owner_secret_hash")
    .maybeSingle();
  if (error) {
    console.error("rewards: saved-at write failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  if (!card) return await apiError("rewards.notFound", 404);
  const response = NextResponse.json({ ok: true });
  const secret = readOwnerSecret(req, code);
  return secret && matchesOwnerSecret(secret, card.owner_secret_hash) ? keepOwnerSecret(response, code, secret) : response;
}

// The delete itself checks both keys. Older cards without a hash can be
// deleted by the restaurant through its manager's card lookup.
export async function DELETE(req: NextRequest) {
  if (await isRateLimited(`rewards:${clientKey(req)}`, 10, 60)) {
    return await apiError("apiErr.tooManyWait", 429);
  }
  const code = normalizeCode(req.nextUrl.searchParams.get("c") ?? "");
  if (!code) return await apiError("rewards.invalid", 400);

  const db = createAdminClient();
  const secret = readOwnerSecret(req, code);
  if (secret) {
    const { data: gone, error } = await db.from("loyalty_cards").delete()
      .eq("code", code).eq("owner_secret_hash", hashOwnerSecret(secret)).select("id");
    if (error) {
      console.error("rewards: card delete failed:", error.message);
      return await apiError("apiErr.generic", 500);
    }
    if (gone?.length) return keepOwnerSecret(NextResponse.json({ ok: true }), code, null);
  }

  const { data: card, error } = await db.from("loyalty_cards").select("id").eq("code", code).maybeSingle();
  if (error) {
    console.error("rewards: card read failed:", error.message);
    return await apiError("apiErr.generic", 500);
  }
  return card ? await apiError("rewards.askRestaurantToDelete", 403) : await apiError("rewards.notFound", 404);
}
