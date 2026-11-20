import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const abortSignal = vi.fn(async () => ({ error: null }));
  return {
    event: { id: "fixture-event", type: "customer.subscription.updated" },
    tasks: [] as (() => Promise<void>)[],
    abortSignal,
    upsert: vi.fn(() => ({ abortSignal })),
  };
});

vi.mock("next/server", async original => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => state.tasks.push(task),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: { webhooks: { constructEvent: () => state.event } },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert: state.upsert }) }),
}));

import { readStripeEvent } from "@/lib/stripe-webhook";

it("returns the verified Stripe event before writing its heartbeat", async () => {
  const request = new NextRequest("https://tabletap.shop/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "fixture-signature" },
    body: "{}",
  });

  await expect(readStripeEvent(request, "fixture-signing-key", "platform")).resolves.toEqual({ event: state.event });
  expect(state.upsert).not.toHaveBeenCalled();
  expect(state.tasks).toHaveLength(1);

  await state.tasks[0]();
  expect(state.upsert).toHaveBeenCalledWith({
    stream: "platform",
    last_type: state.event.type,
    last_ok_at: expect.any(String),
  }, { onConflict: "stream" });
  expect(state.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
