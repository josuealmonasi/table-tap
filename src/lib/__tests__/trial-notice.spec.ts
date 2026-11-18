import { expect, it } from "vitest";
import { trialNotice } from "@/lib/trial-notice";

const now = new Date("2026-11-18T12:00:00Z");
const base = { plan: "servicio", plan_status: "trialing", trial_ends_at: "2026-12-18T12:00:00Z", stripe_subscription_id: null };

it("shows a free trial with the days left, urgent in the last week", () => {
  expect(trialNotice(base, now)).toEqual({ plan: "servicio", days: 30, endsAt: base.trial_ends_at, urgent: false });
  expect(trialNotice({ ...base, trial_ends_at: "2026-11-24T12:00:00Z" }, now)?.urgent).toBe(true);
});

it("says nothing once a card pays, the trial is over, or there is no trial", () => {
  expect(trialNotice({ ...base, stripe_subscription_id: "sub_1" }, now)).toBeNull();
  expect(trialNotice({ ...base, trial_ends_at: "2026-11-17T12:00:00Z" }, now)).toBeNull();
  expect(trialNotice({ ...base, plan_status: "active" }, now)).toBeNull();
  expect(trialNotice({ ...base, trial_ends_at: null }, now)).toBeNull();
});
