import { createHmac, timingSafeEqual } from "node:crypto";
import type { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/** A queued request expires quickly and can be used only once. */
export async function signedRecoveryAuthorized(request: Request, db: Db): Promise<boolean> {
  const secret = process.env.RECOVERY_SIGNING_SECRET;
  const ts = request.headers.get("x-recover-ts") ?? "";
  const nonce = request.headers.get("x-recover-nonce") ?? "";
  const signature = request.headers.get("x-recover-signature") ?? "";
  if (!secret || !/^\d{10}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce) ||
      !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`${ts}.${nonce}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return false;
  const { error } = await db.from("recovery_nonces").insert({ nonce });
  if (error) return false;
  // The unique insert happens first, so concurrent copies cannot both run.
  await db.from("recovery_nonces").delete().lt("at", new Date(Date.now() - 86_400_000).toISOString());
  return true;
}
