import { createAdminClient } from "@/lib/supabase/admin";

/** What the bell shows at once. Older entries stay reachable on the next page. */
export const NOTIFICATION_PAGE_SIZE = 50;
interface Cursor { phase: "u" | "r"; time?: string; id?: string }
interface Entry { id: string; created_at: string; read_at: string | null }

/** Validate before putting a cursor into PostgREST's filter grammar. */
export function notificationCursor(raw: string | null): Cursor | null {
  if (raw === null) return { phase: "u" };
  const [phase, time, id, extra] = raw.split("|");
  if ((phase !== "u" && phase !== "r") || extra !== undefined
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(time ?? "")
    || !Number.isFinite(Date.parse(time))
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id ?? "")) return null;
  return { phase, time, id };
}

/** Unread first, then history. Both time and id keep equal-time rows reachable. */
export async function notificationPage(restaurantId: string, cursor: Cursor) {
  const read = (phase: Cursor["phase"], limit: number, after?: Cursor) => {
    let q = createAdminClient().from("notifications").select("id, kind, data, read_at, created_at")
      .eq("restaurant_id", restaurantId).order("created_at", { ascending: false })
      .order("id", { ascending: false }).limit(limit);
    q = phase === "u" ? q.is("read_at", null) : q.not("read_at", "is", null);
    if (after?.time) q = q.or(`created_at.lt.${after.time},and(created_at.eq.${after.time},id.lt.${after.id})`);
    return q;
  };
  const first = await read(cursor.phase, NOTIFICATION_PAGE_SIZE + 1, cursor);
  if (first.error) return { error: first.error, notifications: [], nextCursor: null };
  let rows: Entry[] = first.data ?? [];
  let phase = cursor.phase;
  if (phase === "u" && rows.length <= NOTIFICATION_PAGE_SIZE) {
    const history = await read("r", NOTIFICATION_PAGE_SIZE + 1 - rows.length);
    if (history.error) return { error: history.error, notifications: [], nextCursor: null };
    rows = [...rows, ...(history.data ?? [])];
    phase = "r";
  }
  const notifications = rows.slice(0, NOTIFICATION_PAGE_SIZE);
  const last = notifications.at(-1);
  // If the page ends on unread food, its next cursor stays in the unread list.
  const nextPhase = last?.read_at === null ? "u" : phase;
  return { error: null, notifications,
    nextCursor: rows.length > NOTIFICATION_PAGE_SIZE && last ? `${nextPhase}|${last.created_at}|${last.id}` : null };
}
