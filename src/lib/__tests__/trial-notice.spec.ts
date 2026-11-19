import { expect, it, vi } from "vitest";

// admin-tier builds the Stripe client at import; the link builder needs none of it.
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { trialNotice } from "@/lib/trial-notice";

const now = new Date("2026-11-18T12:00:00Z");
const base = { plan: "servicio", plan_status: "trialing", trial_ends_at: "2026-12-18T12:00:00Z", stripe_subscription_id: null };

it("shows a free trial with the days left, urgent in the last week", () => {
  expect(trialNotice(base, now)).toEqual({ plan: "servicio", days: 30, endsAt: base.trial_ends_at, urgent: false, assignment: null });
  expect(trialNotice({ ...base, trial_ends_at: "2026-11-24T12:00:00Z" }, now)?.urgent).toBe(true);
});

it("says nothing once a card pays, the trial is over, or there is no trial", () => {
  expect(trialNotice({ ...base, stripe_subscription_id: "sub_1" }, now)).toBeNull();
  expect(trialNotice({ ...base, trial_ends_at: "2026-11-17T12:00:00Z" }, now)).toBeNull();
  expect(trialNotice({ ...base, plan_status: "active" }, now)).toBeNull();
  expect(trialNotice({ ...base, trial_ends_at: null }, now)).toBeNull();
});

it("marks an admin pay-by window as an assignment, not a free trial", () => {
  const n = trialNotice({ ...base, plan: "casa", tier_assignment_id: "00000000-0000-4000-8000-000000000001" }, now);
  expect(n?.assignment).toBe("00000000-0000-4000-8000-000000000001");
});

it("the banner's pay link is the email's, character for character", async () => {
  const { assignedPayLink } = await import("@/lib/admin-tier");
  const { assignedPayPath } = await import("@/lib/assigned-pay-path");
  expect(assignedPayLink("https://tabletap.shop", "casa", "abc")).toBe(`https://tabletap.shop${assignedPayPath("casa", "abc")}`);
});
