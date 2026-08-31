import { describe, expect, it } from "vitest";
import { orderIdFromScan } from "@/lib/scan-target";

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
