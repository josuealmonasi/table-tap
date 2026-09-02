import { describe, it, expect, vi, afterEach } from "vitest";
import { ivaSplit, round2 } from "@/lib/money";

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


describe("rounding to centavos", () => {
  it("rounds a half up and leaves exact amounts alone", () => {
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1.014)).toBe(1.01);
    expect(round2(1.986)).toBe(1.99);
    expect(round2(10)).toBe(10);
    expect(round2(0)).toBe(0);
  });

  it("beats toFixed on the halves binary can represent", () => {
    // 2.675 * 100 is exactly 267.5, so this rounds up; toFixed reads 2.674999…
    // and gives 2.67. A cent is not much — the cart and the bill disagreeing
    // about one is.
    expect(round2(2.675)).toBe(2.68);
    expect(Number((2.675).toFixed(2))).toBe(2.67);
  });

  it("is honest about the halves binary cannot", () => {
    // 1.005 * 100 is 100.49999999999999, so it rounds down. No two-decimal
    // rule in binary floating point escapes this; the point of one shared
    // round2 is that everything is wrong the same way, never by a cent apart.
    expect(round2(1.005)).toBe(1);
    expect(Number((1.005).toFixed(2))).toBe(1);
  });

  it("keeps a sum of many prices exact", () => {
    expect(round2([13.33, 13.33, 13.34].reduce((a, b) => a + b, 0))).toBe(40);
  });
});
