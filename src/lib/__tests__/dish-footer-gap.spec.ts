import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync("src/components/customer/ItemDetailScreen.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");

describe("dish footer separation", () => {
  it("keeps scrolling choices clipped above the action bar even when the deal wraps", () => {
    expect(component).toContain('className="tt-dish-detail-scroll"');
    expect(component).toContain("lineTotal < fullPrice");
    expect(css).toMatch(/\.tt-dish-detail-scroll\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.tt-dish-detail \.tt-detail-actions\s*\{[^}]*padding:\s*(?:1[89]|[2-9]\d)px/);
  });
});
