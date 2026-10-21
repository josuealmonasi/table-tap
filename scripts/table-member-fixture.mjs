import { createHash, randomBytes } from "node:crypto";

/** Explicit admission for legacy gate fixtures; a diner label never authorizes a route. */
export function memberFixture(admin, restaurantId) {
  const phones = new Map();
  const hashes = [];
  const memberIds = new Map();
  async function cookieFor(path, body = {}) {
    const params = new URL(path, "http://fixture").searchParams;
    const r = body.restaurantId ?? params.get("restaurantId") ?? restaurantId;
    const t = body.tableId ?? params.get("tableId");
    const sessionId = body.sessionId ?? params.get("sessionId") ?? params.get("id");
    const label = body.diner ?? params.get("diner") ?? "apicheck";
    if (!phones.has(label)) {
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      phones.set(label, { token, hash });
      hashes.push(hash);
    }
    const phone = phones.get(label);
    // Never seed approval for a foreign restaurant or a mismatched session.
    if (r === restaurantId && (t || sessionId)) {
      let query = admin.from("table_sessions").select("id, table_id")
        .eq("restaurant_id", restaurantId);
      if (t) query = query.eq("table_id", t);
      query = sessionId ? query.eq("id", sessionId) : query.is("closed_at", null);
      const { data: session, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (session) {
        const { data: member, error: writeError } = await admin.from("table_session_members")
          .upsert({ session_id: session.id, token_hash: phone.hash, status: "approved" }, { onConflict: "session_id,token_hash" })
          .select("id").single();
        if (writeError) throw new Error(writeError.message);
        memberIds.set(`${session.id}:${label}`, member.id);
        // Only the gate's own synthetic seats and orders use these labels.
        if (String(label).startsWith("apicheck") || String(label).startsWith("attack-")) {
          const { data: splits } = await admin.from("bill_splits").select("id").eq("session_id", session.id);
          const ids = (splits ?? []).map(s => s.id);
          if (ids.length) await admin.from("bill_split_claims").update({ diner: member.id }).in("split_id", ids).eq("diner", label);
          await admin.from("orders").update({ diner: member.id }).eq("session_id", session.id).eq("diner", label);
        }
      }
    }
    return `tt-table-member=${phone.token}`;
  }
  return {
    cookieFor,
    idFor: (sessionId, label) => memberIds.get(`${sessionId}:${label}`),
    cleanup: async () => {
      if (hashes.length) {
        const { error } = await admin.from("table_session_members").delete().in("token_hash", hashes);
        if (error) throw new Error(error.message);
      }
    },
  };
}

/** Scanning a seated table creates a pending row; browser sweeps must remove theirs. */
export async function forgetBrowserMember(context, admin) {
  const cookie = (await context.cookies()).find(cookie => cookie.name === "tt-table-member");
  if (!cookie) return;
  const hash = createHash("sha256").update(cookie.value).digest("hex");
  const { error } = await admin.from("table_session_members").delete().eq("token_hash", hash);
  if (error) throw new Error(error.message);
}
