import { describe, it, expect, vi, afterEach } from "vitest";
import { ivaSplit } from "@/lib/money";

describe("ivaSplit", () => {
  it("splits an IVA-inclusive total — the 100 → 86.21 + 13.79 example", () => {
    const { net, iva } = ivaSplit(100, 16);
    expect(net).toBeCloseTo(86.21, 2);
    expect(iva).toBeCloseTo(13.79, 2);
  });

  it("treats the whole amount as net when there's no tax", () => {
    expect(ivaSplit(50, 0)).toEqual({ net: 50, iva: 0 });
    expect(ivaSplit(50, -5)).toEqual({ net: 50, iva: 0 });
  });

  it("never loses money: net + iva always equals the subtotal", () => {
    for (const [sub, rate] of [
      [7, 16],
      [123.45, 8],
      [999.99, 21],
    ]) {
      const { net, iva } = ivaSplit(sub, rate);
      expect(net + iva).toBeCloseTo(sub, 10);
    }
  });
});

