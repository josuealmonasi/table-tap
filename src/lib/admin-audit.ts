import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api-error";
import { getPlatformAdmin } from "@/lib/admin";
import { jsonBody } from "@/lib/json-body";
import { createAdminClient } from "@/lib/supabase/admin";

type Facts = Record<string, string | boolean | number | null>;
type Action = "login.create" | "login.update" | "login.delete" | "restaurant.delete" | "restaurant.plan" | "plan.price"
  | "restaurant.suspend" | "restaurant.unsuspend" | "restaurant.trial"
  | "restaurant.owner_transfer"
  | "restaurant.owner_reset"
  | "restaurant.note";
type AuditBody = Record<string, unknown>;
export interface AdminAuditContext<Body extends AuditBody = AuditBody> {
  targetId?: string;
  body: Body | null;
}
type Handler<Body extends AuditBody> = (req: NextRequest, audit: AdminAuditContext<Body>) => Promise<Response>;
type Db = ReturnType<typeof createAdminClient>;

// Copy named facts only. In particular, neither request bodies, Auth results,
// provider errors nor passwords ever enter this stream.
function requestedFacts(body: Record<string, unknown>, action: Action): Facts {
  const facts: Facts = {};
  for (const key of ["email", "role", "plan", "restaurantId"]) {
    if (typeof body[key] === "string") facts[key] = body[key];
  }
  if (typeof body.fullName === "string") facts.full_name = body.fullName.trim();
  if (typeof body.password === "string") facts[action === "login.create" ? "password_set" : "password_reset"] = true;
  // Who receives the restaurant; who it came from is in the before facts.
  if (action === "restaurant.owner_transfer" && typeof body.userId === "string") facts.new_owner_id = body.userId;
  if (action === "plan.price") {
    if (typeof body.newPrice === "number") facts.new_price = body.newPrice;
    if (typeof body.effectiveAt === "string") facts.effective_at = body.effectiveAt;
  }
  return facts;
}

async function beforeFacts(db: Db, action: Action, id?: string): Promise<Facts> {
  // Invalid targets still reach the route's validation, never a uuid cast.
  if (action === "plan.price" || !id || !/^[0-9a-f-]{36}$/i.test(id)) return {};
  if (action.startsWith("restaurant.")) {
    const { data, error } = await db.from("restaurants").select("name, plan, plan_status, owner_id").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? { name: data.name, plan: data.plan, plan_status: data.plan_status, owner_id: data.owner_id } : {};
  }
  const { data: admin, error: adminError } = await db.from("platform_admins").select("email").eq("user_id", id).maybeSingle();
  if (adminError) throw adminError;
  if (admin) return { role: "admin", email: admin.email };
  const { data: owner, error: ownerError } = await db.from("restaurants").select("id").eq("owner_id", id).limit(1).maybeSingle();
  if (ownerError) throw ownerError;
  if (owner) return { role: "founding_owner", restaurantId: owner.id };
  const { data: member, error } = await db.from("staff").select("email, role, restaurant_id").eq("user_id", id).maybeSingle();
  if (error) throw error;
  return member ? { email: member.email, role: member.role, restaurantId: member.restaurant_id } : {};
}

/** Start before any sensitive write. A process crash leaves an explicit
 * unresolved attempt; results append another row, never rewrite history. */
export function auditedAdminAction<Body extends AuditBody>(action: Action, handler: Handler<Body>) {
  return async (req: NextRequest): Promise<Response> => {
    const admin = await getPlatformAdmin();
    if (!admin) return await apiError("apiErr.forbidden", 403);
    // Use one read for both the audit and the action.
    const body = await jsonBody<Body>(req);
    const target = action.startsWith("restaurant.") ? body?.id : body?.userId;
    const context: AdminAuditContext<Body> = { body, targetId: typeof target === "string" ? target : undefined };
    const db = createAdminClient();
    const attempt = randomUUID();
    let before: Facts;
    const requested = requestedFacts(body ?? {}, action);
    const append = async (outcome: string, after: Facts) => {
      const { error } = await db.from("platform_admin_audit").insert({
        attempt_id: attempt, actor_id: admin.userId, actor_email: admin.email,
        target_type: action === "plan.price" ? "plan" : action.startsWith("restaurant.") ? "restaurant" : "login",
        target_id: context.targetId ?? null, action, outcome,
        before_facts: before, after_facts: after,
      });
      if (error) throw new Error("Platform audit write failed");
    };
    try {
      before = await beforeFacts(db, action, context.targetId);
      await append("started", requested);
    } catch {
      return await apiError("apiErr.adminAuditUnavailable", 503);
    }
    let response: Response;
    try {
      response = await handler(req, context);
    } catch {
      await append("uncertain", {}).catch(() => {});
      return await apiError("apiErr.adminActionUncertain", 503);
    }
    try {
      await append(response.ok ? "succeeded" : response.status < 500 ? "refused" : "uncertain", {
        ...(response.ok ? requested : {}), http_status: response.status,
        ...(response.ok && action.endsWith(".delete") ? { deleted: true } : {}),
      });
    } catch {
      // The durable start still names the action and target. Do not claim
      // completion if its result could not be recorded.
      return await apiError("apiErr.adminActionUncertain", 503);
    }
    return response;
  };
}
