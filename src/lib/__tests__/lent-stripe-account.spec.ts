import { describe, expect, it } from "vitest";
import { accountToRestore, isLentAccount } from "../../../scripts/lent-stripe-account.mjs";

describe("a gate's lent Stripe account is never kept", () => {
  it("knows every fake the gates lend, and no real id", () => {
    expect(isLentAccount("acct_api_check")).toBe(true);
    expect(isLentAccount("acct_api_check_account")).toBe(true);
    expect(isLentAccount("acct_1QabcDEFghiJKL12")).toBe(false);
    expect(isLentAccount(null)).toBe(false);
  });

  it("puts back a real account, but never a lend that was left behind", () => {
    expect(accountToRestore({ stripe_account_id: "acct_1QabcDEFghiJKL12", stripe_charges_enabled: true }))
      .toEqual({ stripe_account_id: "acct_1QabcDEFghiJKL12", stripe_charges_enabled: true });
    // The leak: an interrupted run left the fake, and the next case saved it as the original.
    expect(accountToRestore({ stripe_account_id: "acct_api_check", stripe_charges_enabled: true }))
      .toEqual({ stripe_account_id: null, stripe_charges_enabled: false });
    expect(accountToRestore(null)).toEqual({ stripe_account_id: null, stripe_charges_enabled: false });
  });
});
