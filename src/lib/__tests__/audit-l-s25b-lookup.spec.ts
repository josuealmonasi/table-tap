import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// After a route has looked its reference up and found nothing saved, a
// refusal settles the attempt: a sold-out dish, a closed kitchen. Unmarked,
// the diner or waiter was left on "send again" with a cart that could never
// go (audit L, 5). Before the lookup a frozen plan or a lapsed sign-in must
// keep the reference, so only what follows the lookup is held to this.
const ROUTES = [
  { file: "src/app/api/checkout/route.ts", lookup: "const afterLookup = ", mark: "afterLookup(" },
  { file: "src/app/api/table-order/route.ts", lookup: "const afterLookup = ", mark: "afterLookup(" },
  { file: "src/app/api/pos/order/route.ts", lookup: "if (already) return already;", mark: "uncommittedRefusal(" },
];

it("L5 every refusal after the reference lookup says nothing was saved", () => {
  const unmarked: string[] = [];
  for (const { file, lookup, mark } of ROUTES) {
    const lines = readFileSync(file, "utf8").split("\n");
    const from = lines.findIndex(line => line.includes(lookup));
    expect(from, `${file} has no lookup line`).toBeGreaterThan(0);
    lines.slice(from + 1).forEach((line, i) => {
      const refusal = /return await (apiError|refuseCart|chargeRefusal)\(/.test(line)
        || /return NextResponse\.json\(.*status: 4\d\d/.test(line);
      if (!refusal) return;
      // A conflict belongs to another request; a held ticket stays on the device;
      // a 5xx may have committed. Those keep the reference.
      if (/retryConflict|held: true|, 5\d\d\b/.test(line)) return;
      if (!line.includes(mark) && !line.includes("retryUncommitted: true")) unmarked.push(`${file}:${from + 2 + i}: ${line.trim()}`);
    });
  }
  expect(unmarked).toEqual([]);
});

it("L5 the frozen plan is refused before the lookup, so its reference is kept", () => {
  for (const file of ["src/app/api/table-order/route.ts", "src/app/api/pos/order/route.ts"]) {
    const source = readFileSync(file, "utf8");
    const frozen = source.indexOf("frozenBlocks(actor.restaurantId)");
    const lookup = Math.max(source.indexOf("readOrderIntent(intent)"), source.indexOf("existingTicket(db, posRef"));
    expect(frozen, file).toBeGreaterThan(0);
    expect(frozen, file).toBeLessThan(lookup);
  }
});
