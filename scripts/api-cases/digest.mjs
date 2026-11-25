import { createHash } from "node:crypto";

// The daily digest's extra recipients (owner decisions 2026-11-25): owner only,
// at most five, nothing sent until the address confirms. The demo seeds one
// confirmed and one pending address; these cases restore what they change.
const STOP_CONFIRMED = "demoDigestStopConfirmed00000000000000000000";
const UNKNOWN = "unknownDigestToken000000000000000000000000";

export function digestCases() {
  return [
    { name: "GET  /api/settings/digest-recipients", as: "owner", method: "GET", path: "/api/settings/digest-recipients",
      expect: [200], check: d => (Array.isArray(d.recipients) && d.max === 5) || "no recipients list or wrong limit" },
    { name: "GET  /api/settings/digest-recipients (a manager refused)", as: "manager", method: "GET",
      path: "/api/settings/digest-recipients", expect: [403] },
    { name: "POST /api/settings/digest-recipients (a bad address refused)", as: "owner", method: "POST",
      path: "/api/settings/digest-recipients", body: { email: "not-an-email" }, expect: [400],
      expectError: /correo válido|valid email/i },
    { name: "POST /api/settings/digest-recipients (an address already listed refused)", as: "owner", method: "POST",
      path: "/api/settings/digest-recipients", body: { email: "contador@example.test" }, expect: [409],
      expectError: /ya está en la lista|already on the list/i },
    { name: "POST /api/digest/confirm (an unknown link refused)", as: "diner", method: "POST",
      path: "/api/digest/confirm", body: { token: UNKNOWN }, expect: [404] },
    { name: "POST /api/digest/stop (an unknown link refused)", as: "diner", method: "POST",
      path: "/api/digest/stop", body: { token: UNKNOWN }, expect: [404] },
    { name: "POST /api/digest/stop (the confirmed address stops, then is restored)", as: "diner", method: "POST",
      path: "/api/digest/stop", body: { token: STOP_CONFIRMED }, expect: [200],
      arrange: async f => {
        const { data: original, error } = await f.admin.from("digest_recipients").select("*")
          .eq("restaurant_id", f.restaurant.id).eq("stop_token", STOP_CONFIRMED).single();
        if (error) throw error;
        const addressKey = createHash("sha256").update(original.email.trim().toLowerCase()).digest("hex");
        const stop = () => f.admin.from("digest_staff_stops").select("address_key")
          .eq("restaurant_id", f.restaurant.id).eq("address_key", addressKey);
        const { data: priorStop, error: stopError } = await stop().maybeSingle();
        if (stopError) throw stopError;
        return async () => {
          const { error: restoreError } = await f.admin.from("digest_recipients")
            .upsert(original, { onConflict: "id", ignoreDuplicates: true });
          if (restoreError) throw restoreError;
          if (!priorStop) {
            const { error: cleanupError } = await f.admin.from("digest_staff_stops").delete()
              .eq("restaurant_id", f.restaurant.id).eq("address_key", addressKey);
            if (cleanupError) throw cleanupError;
          }
        };
      },
      check: async (d, f) => {
        const { data } = await f.admin.from("digest_recipients").select("id").eq("stop_token", STOP_CONFIRMED).maybeSingle();
        if (data) return "answered 200 and the address is still listed";
        return typeof d.restaurant === "string" || "no restaurant name in the answer";
      } },
  ];
}
