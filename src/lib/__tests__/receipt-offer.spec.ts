import { describe, expect, it } from "vitest";
import { receiptTargets } from "@/lib/receipt-offer";

const ORDER = "41e7ac69-722e-4f5d-ba6a-7373905ef51d";
const OTHER = "2b71dead-722e-4f5d-ba6a-7373905ef51d";
const base = { search: "", paidOrderId: null, settling: [], asked: [] };

describe("who gets offered a receipt", () => {
  it("offers nothing on an ordinary visit to the menu", () => {
    expect(receiptTargets({ ...base, search: "?item=abc" })).toEqual([]);
  });

  it("offers the order that was just paid for by card", () => {
    expect(receiptTargets({ ...base, search: "?paid=1", paidOrderId: ORDER })).toEqual([ORDER]);
  });

  it("offers everything a table settled together", () => {
    expect(
      receiptTargets({ ...base, search: "?settled=1", settling: [ORDER, OTHER] }),
    ).toEqual([ORDER, OTHER]);
  });

  it("asks once — a refresh with the flag still in the URL is not a second payment", () => {
    expect(
      receiptTargets({ ...base, search: "?paid=1", paidOrderId: ORDER, asked: [ORDER] }),
    ).toEqual([]);
  });

  it("still offers the rest when only part of a settlement was asked about", () => {
    expect(
      receiptTargets({ ...base, search: "?settled=1", settling: [ORDER, OTHER], asked: [ORDER] }),
    ).toEqual([OTHER]);
  });

  it("stays quiet when the return has no stash to go on", () => {
    // Storage disabled, or a link somebody shared with the flag still on it.
    expect(receiptTargets({ ...base, search: "?settled=1" })).toEqual([]);
    expect(receiptTargets({ ...base, search: "?paid=1" })).toEqual([]);
  });
});
