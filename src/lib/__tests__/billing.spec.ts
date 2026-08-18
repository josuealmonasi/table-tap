import { describe, expect, it } from "vitest";
import { isSelfServe, readPlanName, subscriptionOutcome } from "@/lib/billing";

describe("what a Stripe status means here", () => {
  it("keeps the tier while the subscription is healthy", () => {
    expect(subscriptionOutcome("active", "casa")).toEqual({
      plan: "casa",
      status: "active",
    });
    expect(subscriptionOutcome("trialing", "servicio")).toEqual({
      plan: "servicio",
      status: "trialing",
    });
  });

  it("keeps them working while a payment is being retried", () => {
    // past_due is a conversation, not a shutdown — Stripe is still retrying.
    expect(subscriptionOutcome("past_due", "casa")).toEqual({
      plan: "casa",
      status: "past_due",
    });
    expect(subscriptionOutcome("incomplete", "casa").status).toBe("past_due");
  });

  it("freezes only once Stripe has given up", () => {
    expect(subscriptionOutcome("unpaid", "casa").status).toBe("locked");
  });

  it("treats cancelling as leaving, not as owing", () => {
    // Someone who cancels did what we asked them to do to leave. They become
    // a free customer; they do not get locked out.
    expect(subscriptionOutcome("canceled", "casa")).toEqual({
      plan: "carta",
      status: "active",
    });
    expect(subscriptionOutcome("incomplete_expired", "servicio")).toEqual({
      plan: "carta",
      status: "active",
    });
  });

  it("errs towards leaving them working on a status it doesn't know", () => {
    // Stripe adds statuses. Freezing a restaurant that has paid is the worse
    // way to be wrong.
    expect(subscriptionOutcome("something_new", "casa").status).toBe("past_due");
  });
});

describe("reading a plan name off untrusted input", () => {
  it("accepts the four we sell", () => {
    expect(readPlanName("servicio")).toBe("servicio");
    expect(readPlanName("grupo")).toBe("grupo");
  });

  it("refuses anything else", () => {
    expect(readPlanName("enterprise")).toBeNull();
    expect(readPlanName(undefined)).toBeNull();
    expect(readPlanName(42)).toBeNull();
  });
});

describe("which tiers a restaurant can buy on its own", () => {
  it("is the two paid self-serve ones", () => {
    expect(isSelfServe("servicio")).toBe(true);
    expect(isSelfServe("casa")).toBe(true);
  });

  it("excludes the free tier and the one that needs a conversation", () => {
    expect(isSelfServe("carta")).toBe(false);
    expect(isSelfServe("grupo")).toBe(false);
  });
});
