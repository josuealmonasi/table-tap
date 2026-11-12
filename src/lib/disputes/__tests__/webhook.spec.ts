import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { notification } from "./fixtures";
const mocks = vi.hoisted(() => ({ read: vi.fn(), ingest: vi.fn() }));
vi.mock("@/lib/stripe-webhook", () => ({ readStripeEvent: mocks.read }));
vi.mock("@/lib/disputes/ingest", () => ({ ingestDispute: mocks.ingest }));
vi.mock("@/lib/checkout-settle", () => ({ abandonCheckout: vi.fn(), settleCheckout: vi.fn() }));
vi.mock("@/lib/stripe-connect", () => ({ syncConnectAccount: vi.fn() }));
vi.mock("@/lib/refunds/provider-failure", () => ({ REFUND_FAILURE_EVENTS: new Set(), reopenFailedRefund: vi.fn() }));
vi.mock("@/lib/refunds/fee-queue", () => ({ enqueueRefundFee: vi.fn() }));
import { POST } from "@/app/api/webhooks/stripe/connect/route";
const req = () => new NextRequest("https://test/api/webhooks/stripe/connect", { method: "POST" });
beforeEach(() => vi.resetAllMocks());
it.each(["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated"])("Connect endpoint persists %s before 200", async type => {
  const event = notification(type); mocks.read.mockResolvedValue({ event });
  mocks.ingest.mockResolvedValue(undefined);
  expect((await POST(req())).status).toBe(200);
  expect(mocks.ingest).toHaveBeenCalledWith(event);
});
it("an inbox rejection prevents acknowledgment", async () => {
  mocks.read.mockResolvedValue({ event: notification() }); mocks.ingest.mockRejectedValue(new Error("inbox unavailable"));
  await expect(POST(req())).rejects.toThrow("inbox unavailable");
});
it("invalid signatures never reach ingestion", async () => {
  mocks.read.mockResolvedValue({ refusal: NextResponse.json({}, { status: 400 }) });
  expect((await POST(req())).status).toBe(400);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
