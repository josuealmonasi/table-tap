import type { NextRequest } from "next/server";
import { actingFrontOfHouse } from "@/lib/api-guard";
import { tableMember, openSittingAt } from "@/lib/table-membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { cardState, CARD_COLUMNS, programOf } from "./server";
import { standing } from "./standing";
import type { ReceiptCard } from "./attachment";

export interface AttachmentTarget {
  restaurantId?: unknown;
  orderId?: unknown;
  sessionId?: unknown;
  tableId?: unknown;
  preview?: unknown;
}
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);

/** A diner credential grants a live sitting, never an arbitrary order or preview. */
export async function attachmentAccess(req: NextRequest, body: AttachmentTarget) {
  const actor = await actingFrontOfHouse();
  if (actor) {
    if (body.restaurantId !== undefined && body.restaurantId !== actor.restaurantId) return null;
    if (body.preview === true) {
      if (body.orderId || body.sessionId || body.tableId) return null;
      return { restaurantId: actor.restaurantId, actor: actor.email, staff: true, orderId: null, sessionId: null };
    }
    if ([body.orderId, body.sessionId, body.tableId].filter(Boolean).length !== 1) return null;
    if (body.orderId && !uuid(body.orderId) || body.sessionId && !uuid(body.sessionId) || body.tableId && !uuid(body.tableId)) return null;
    const sessionId = body.tableId ? await openSittingAt(actor.restaurantId, body.tableId as string) : body.sessionId;
    return { restaurantId: actor.restaurantId, actor: actor.email, staff: true,
      orderId: (body.orderId as string) || null, sessionId: (sessionId as string) || null };
  }
  if (body.orderId || body.preview || !uuid(body.restaurantId) || !uuid(body.tableId) || !uuid(body.sessionId)) return null;
  const member = await tableMember(req, body.restaurantId, body.tableId, body.sessionId);
  if (!member || member.closed || member.sessionId !== body.sessionId) return null;
  return { restaurantId: member.restaurantId, actor: "diner", staff: false, orderId: null, sessionId: member.sessionId };
}

export type AttachmentAccess = NonNullable<Awaited<ReturnType<typeof attachmentAccess>>>;

/** Read failures must not masquerade as an empty card or an empty bill. */
interface AttachmentRow { loyalty_card_id: string | null; paid?: boolean; status?: string; closed_at?: string | null }
export async function attachmentRow(access: AttachmentAccess): Promise<AttachmentRow | null> {
  const db = createAdminClient();
  const { data, error } = access.orderId
    ? await db.from("orders").select("loyalty_card_id, paid, status")
      .eq("restaurant_id", access.restaurantId).eq("id", access.orderId).maybeSingle()
    : await db.from("table_sessions").select("loyalty_card_id, closed_at")
      .eq("restaurant_id", access.restaurantId).eq("id", access.sessionId).maybeSingle();
  if (error) throw new Error("Could not read loyalty attachment");
  return data;
}

export async function receiptCard(restaurantId: string, cardId: string): Promise<ReceiptCard | null> {
  const { data, error } = await createAdminClient().from("loyalty_cards").select(`${CARD_COLUMNS}, code`)
    .eq("restaurant_id", restaurantId).eq("id", cardId).maybeSingle();
  if (error) throw new Error("Could not read attached loyalty card");
  if (!data) return null;
  const program = await programOf(restaurantId, true);
  const state = await cardState(data, program?.reward ?? "");
  if (!state) throw new Error("Could not read attached loyalty progress");
  return { cardId: data.id, suffix: data.code.slice(-4), progress: state.progress, goal: data.goal,
    standing: standing(state.progress, state.ladder, state.done) };
}

/** Resolve a presented bearer code inside this restaurant, never trust a row id. */
export async function cardForSale(restaurantId: string, code: string): Promise<string | null> {
  const { data, error } = await createAdminClient().from("loyalty_cards").select("id")
    .eq("restaurant_id", restaurantId).eq("code", code).maybeSingle();
  if (error) throw new Error("Could not resolve loyalty card");
  return data?.id ?? null;
}
