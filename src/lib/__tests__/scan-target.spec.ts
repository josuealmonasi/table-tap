import { describe, expect, it } from "vitest";
import { orderIdFromScan, tableFromScan } from "@/lib/scan-target";

const ID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("reading a scanned code", () => {
  it("takes the order out of the link the tracker shows", () => {
    expect(orderIdFromScan(`https://tabletap.mx/dashboard/bills?order=${ID}`)).toBe(ID);
  });

  it("accepts a bare id, in case one is ever printed without the link", () => {
    expect(orderIdFromScan(ID)).toBe(ID);
  });

  it("ignores anything else the camera happens to see", () => {
    // A poster, a wifi card, a phone number — a scanner points at the world.
    expect(orderIdFromScan("https://example.com")).toBeNull();
    expect(orderIdFromScan("WIFI:S:Cafe;T:WPA;P:hunter2;;")).toBeNull();
    expect(orderIdFromScan("hola")).toBeNull();
    expect(orderIdFromScan("")).toBeNull();
    expect(orderIdFromScan(null)).toBeNull();
  });

  it("refuses an order parameter that is not an id", () => {
    // Nothing downstream should be handed something to look up that cannot be
    // one of ours.
    expect(orderIdFromScan("https://x.dev/dashboard/bills?order=1 OR 1=1")).toBeNull();
    expect(orderIdFromScan("https://x.dev/dashboard/bills?order=")).toBeNull();
  });

  it("does not mind which host the code came from", () => {
    // Staff scan from a preview deploy, a phone on the local network, or
    // production. The restaurant scoping happens later, on the bill itself.
    expect(orderIdFromScan(`http://localhost:3000/dashboard/bills?order=${ID}`)).toBe(ID);
  });
});

const REST = "9d763b33-82ac-4e51-82c6-6dcaeb463342";
const TABLE = "6fee31e8-812a-4373-9365-d5ed3205ba26";

describe("reading the code stuck to a table", () => {
  it("takes the restaurant and the table out of the menu link", () => {
    expect(tableFromScan(`https://tabletap.mx/r/${REST}/t/${TABLE}`)).toEqual({
      restaurantId: REST,
      tableId: TABLE,
    });
  });

  it("does not mind a query string or which host printed it", () => {
    expect(tableFromScan(`http://localhost:3000/r/${REST}/t/${TABLE}?settled=1`)).toEqual({
      restaurantId: REST,
      tableId: TABLE,
    });
  });

  it("hands the restaurant back so the caller can refuse another one", () => {
    // A neighbouring venue's code decodes perfectly well. Pointing an order at
    // their table is exactly what must not happen quietly, so the id comes
    // back rather than being dropped here.
    const other = "00000000-0000-4000-8000-000000000000";
    expect(tableFromScan(`https://tabletap.mx/r/${other}/t/${TABLE}`)?.restaurantId).toBe(other);
  });

  it("refuses the general code, which is a restaurant and no table", () => {
    expect(tableFromScan(`https://tabletap.mx/r/${REST}`)).toBeNull();
  });

  it("refuses a path that only starts the same way", () => {
    expect(tableFromScan(`https://tabletap.mx/r/${REST}/t/${TABLE}/extra`)).toBeNull();
    expect(tableFromScan(`https://tabletap.mx/r/${REST}/x/${TABLE}`)).toBeNull();
  });

  it("refuses anything in those places that is not an id", () => {
    expect(tableFromScan("https://tabletap.mx/r/1 OR 1=1/t/2")).toBeNull();
    expect(tableFromScan(`https://tabletap.mx/r/${REST}/t/../../admin`)).toBeNull();
  });

  it("ignores anything else the camera happens to see", () => {
    expect(tableFromScan("WIFI:S:Cafe;T:WPA;P:hunter2;;")).toBeNull();
    expect(tableFromScan("hola")).toBeNull();
    expect(tableFromScan("")).toBeNull();
    expect(tableFromScan(null)).toBeNull();
  });

  it("is not confused by a bill code, nor the bill reader by a table one", () => {
    // Both scanners look at the same world through the same lens.
    expect(tableFromScan(`https://tabletap.mx/dashboard/bills?order=${ID}`)).toBeNull();
    expect(orderIdFromScan(`https://tabletap.mx/r/${REST}/t/${TABLE}`)).toBeNull();
  });
});
