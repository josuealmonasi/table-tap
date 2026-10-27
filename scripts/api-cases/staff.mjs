import { MARK } from "../api-fixtures.mjs";

export function staffCases() {
  return [
    // ── the team ─────────────────────────────────────────────────────────
    // Inviting sends mail through Supabase's own service, which without SMTP
    // configured refuses valid addresses or caps at a few per hour. Today an owner
    // CANNOT add their team: the demo team exists because the seed creates it
    // directly, not by invitation.
    { name: "POST /api/staff (invite)", as: "owner", method: "POST", path: "/api/staff",
      body: { email: `${MARK}@tabletap.dev`, role: "waiter" }, expect: [200],
      known: "Supabase has no SMTP: inviting by email does not work" },
    // These two decide who may do what, and neither had ever run: both looked
    // the member up by the email the INVITE case uses, inviting needs SMTP
    // development does not have, so the id was always empty and both routes
    // refused on the missing field. `expect: [200, 400, 404]` took it.
    //
    // The fixture now puts a real member on the payroll for them to act on.
    { name: "PATCH /api/staff (change role)", as: "owner", method: "PATCH", path: "/api/staff",
      body: async f => ({ id: f.crewId, role: "cashier" }), expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("staff").select("role").eq("id", f.crewId).maybeSingle();
        return data?.role === "cashier" ? true : `answered 200 and the role is still "${data?.role}"`;
      } },
    // A bad role and a missing id share one message, so the text cannot tell
    // them apart — what does is that the member is real, which leaves the role
    // as the only thing here to refuse.
    { name: "PATCH /api/staff (a role that does not exist)", as: "owner", method: "PATCH",
      path: "/api/staff", body: async f => ({ id: f.crewId, role: "emperor" }),
      expect: [400] },
    { name: "PATCH /api/staff (manager cannot promote)", as: "manager", method: "PATCH",
      path: "/api/staff", body: async f => ({ id: f.crewId, role: "owner" }),
      // 403 and nothing else. "owner" is a real role and the member is real,
      // so the only thing left to refuse on is who is asking — a manager who
      // can mint an owner is a manager who owns the restaurant. Accepting 400
      // here would also accept the state this case spent its life in, where
      // there was no member and the id was empty.
      expect: [403],
      check: () => "a manager changed a role and was told 200" },
    { name: "DELETE /api/staff", as: "owner", method: "DELETE", path: "/api/staff",
      body: async f => ({ id: f.crewId }), expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("staff").select("id").eq("id", f.crewId).maybeSingle();
        return data ? "answered 200 and the member is still on the payroll" : true;
      } },
  ];
}
