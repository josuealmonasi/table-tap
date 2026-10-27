import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { walkAll, sources, read } from "./helpers";

describe("dialogs do not stack", () => {
  it("never renders a dialog inside another dialog", () => {
    // Two open dialogs run two focus traps against each other and take two
    // Escapes to leave. This shipped three times: the receipt prompt over the
    // tracker, the write-off reason over the settle sheet, and again over the
    // bill discount dialog. The fix each time is to render the second as a
    // sibling and close the first.
    const offenders: string[] = [];
    for (const file of sources) {
      const body = read(file);
      for (const block of body.matchAll(/<Modal\b[^>]*>([\s\S]*?)<\/Modal>/g)) {
        for (const nested of new Set(
          [...block[1].matchAll(/<([A-Z][A-Za-z]*(?:Dialog|Sheet|Prompt))\b/g)].map(m => m[1]),
        )) {
          offenders.push(`${file}: <${nested}>`);
        }
      }
    }
    expect(offenders, `nested dialogs: ${offenders.join("; ")}`).toEqual([]);
  });
});

describe("nothing that moves money waits offline", () => {
  /**
   * A status move is safe to hold and replay: marking a ready ticket ready
   * again changes nothing. A payment is not. A settlement replayed on
   * reconnect charges a table twice, a refund replayed gives money away twice,
   * and an approval replayed decides on a board that has moved on.
   *
   * So the queue takes order status and nothing else, and this is what says so
   * — the file is small enough to read, and the next person adding a route to
   * it will find out here rather than from a double charge.
   */
  it("queues no endpoint but the order board's own", () => {
    const src = fs.readFileSync("src/hooks/useRestaurantOrders.ts", "utf8");
    const queued = [...src.matchAll(/writeQueue\(|enqueue\(/g)];
    expect(queued.length, "the queue is no longer wired in").toBeGreaterThan(0);

    // Every path that reaches the queue sits in this one hook, and the only
    // endpoint it sends is /api/orders. Anything else here is a red flag.
    const endpoints = [...src.matchAll(/fetch\(\s*"(\/api\/[^"]+)"/g)].map(m => m[1]);
    const forbidden = endpoints.filter(e => e !== "/api/orders" && e !== "/api/orders/cancel");
    expect(
      forbidden,
      `a money endpoint is being called from the hook that holds work offline —\nqueue order status only:\n${forbidden.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps the offline queue out of every settlement path", () => {
    const offenders: string[] = [];
    for (const file of walkAll("src/components").concat(walkAll("src/hooks"))) {
      if (file.endsWith("useRestaurantOrders.ts")) continue;
      const src = fs.readFileSync(file, "utf8");
      if (/\bfrom "@\/lib\/offline-queue"/.test(src)) offenders.push(file);
    }
    expect(
      offenders,
      `only the order board may hold work offline; these import the queue:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Every route reads its body through `jsonBody`.
 *
 * `await req.json()` throws on anything that is not JSON and hands back a
 * perfectly good `null` for the body `null`, which then throws again the moment
 * somebody destructures it. Twenty-seven routes answered 500 to a truncated
 * upload, an empty POST or the four characters `null` — several of them
 * reachable with no login at all: calling a waiter, rating a dish, checking a
 * coupon, signing up.
 *
 * `.catch(() => ({}))` was the older attempt and covers only half of it: the
 * parse error, not the body that parses into something with no fields.
 */
describe("no route parses a body by hand", () => {
  it("reads every request body through jsonBody", () => {
    const raw = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /await req\.json\(\)/.test(read(f)));
    expect(
      raw,
      `These parse a body directly, so malformed input reaches them as an exception.\n` +
        `Use \`jsonBody\` and answer 400:\n${raw.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a refusal always carries a sentence", () => {
  it("never answers a bare rejection object", () => {
    // `/api/table-order` returned `{ rejection }` — a shape with no `error`
    // field. The waiter's screen falls back to "network error" when there is
    // no message, so a sold-out dish read as a dead connection: the waiter
    // retried instead of telling the table. Every refusal a screen shows has
    // to arrive as words.
    const bare = walkAll("src/app/api")
      .filter(f => f.endsWith("route.ts"))
      .filter(f => /json\(\s*\{\s*rejection\b/.test(read(f)));
    expect(
      bare,
      `These answer with a rejection the client cannot render, so it shows a\n` +
        `network error instead. Translate it with \`rejectionMessage\`:\n${bare.join("\n")}`,
    ).toEqual([]);
  });

  it("wires every CartRejection kind to a message", () => {
    // The mapping is exhaustive by type, but a new kind added with a `return`
    // in the wrong place would silently fall through to the extras sentence.
    const kinds = [...read("src/lib/verify-cart.ts").matchAll(/\{ kind: "(\w+)"/g)].map(m => m[1]);
    const wiring = read("src/lib/cart-rejection.ts");
    const unwired = [...new Set(kinds)].filter(k => !wiring.includes(`"${k}"`));
    expect(
      unwired,
      `These rejection kinds have no branch in rejectionMessage:\n${unwired.join("\n")}`,
    ).toEqual([]);
  });
});

describe("a polled route is sized for the room that polls it", () => {
  // Every public limit is keyed by address, and a restaurant's Wi-Fi is one
  // address for the whole room. The tracker's route allowed 120 a minute —
  // "far above what a real diner's phone asks for" — and thirty diners on the
  // menu, each following one order, used all of it. The poll and the limit
  // were two numbers in two files; now both come from poll.ts.
  const POLLED = {
    "/api/order-status": "src/app/api/order-status/route.ts",
    "/api/split?": "src/app/api/split/route.ts",
    "/api/bill?": "src/app/api/bill/route.ts",
  } as const;
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("polls these routes only at an interval from poll.ts", () => {
    const pollers: string[] = [];
    const offenders: string[] = [];
    for (const file of walkAll("src").filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__") && !f.includes("/app/api/"))) {
      const src = code(file);
      if (!Object.keys(POLLED).some(route => src.includes(route)) || !src.includes("setInterval(")) continue;
      pollers.push(file);
      const fromPoll = /from "@\/lib\/poll"/.test(src);
      const literal = /setInterval\([^;]*?,\s*[\d_]+\s*\)/.test(src);
      if (!fromPoll || literal) offenders.push(file);
    }
    expect(pollers.length, "no poller of these routes was found — the scan broke").toBeGreaterThan(3);
    expect(offenders, `a poll whose rate its route does not know:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("sizes each of those routes' limits from the same poll", () => {
    const offenders = Object.values(POLLED).filter(f => {
      const hits = [...code(f).matchAll(/isRateLimited\(`(order-status|split|bill):\$\{clientKey\(req\)\}`,\s*([^,]+),/g)];
      return hits.length === 0 || hits.some(m => !m[2].includes("forTheRoom("));
    });
    expect(offenders, `a limit sized for one phone:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the offline refusal is only said where it is true", () => {
  it("keeps \"you need a connection to take payment, cancel or approve\" to those", () => {
    // It was used for any failed request on the visit card screens: a diner
    // making a card offline was told they needed a connection to take a
    // payment. A plain network error says what happened there.
    const MONEY = [
      "src/components/dashboard/SettleTableDialog.tsx",
      "src/components/dashboard/TableCalculator.tsx",
      "src/hooks/useRestaurantOrders.ts",
    ];
    const users = walkAll("src")
      .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__") && !f.includes("/i18n/"))
      .filter(f => read(f).includes('t("offline.blocked")'));
    expect(users.filter(f => !MONEY.includes(f)), "the payment-only offline line, said about something else").toEqual([]);
    expect(users.length, "no screen says it any more — the scan broke").toBeGreaterThan(0);
  });
});

describe("a card brings its own padding", () => {
  it("never uses .tt-card without padding from its own style or another class", () => {
    // `.tt-card` draws the frame — background, border, radius — and leaves
    // the padding to whoever uses it. Every user set it inline except the
    // visit card offer, whose words and button sat on the border on the
    // paid-order screen until somebody opened it from the menu and looked.
    const css = read("src/app/globals.css");
    const padded = (cls: string): boolean =>
      new RegExp(`(^|[\\s,])\\.${cls}\\s*(,[^{]*)?\\{[^}]*\\bpadding\\b`, "m").test(css);
    const offenders: string[] = [];
    const files = walkAll("src").filter(f => f.endsWith(".tsx") && !f.includes("__tests__"));
    for (const file of files) {
      const src = read(file);
      for (const m of src.matchAll(/"([^"\n]*)"/g)) {
        const classes = m[1].split(/\s+/);
        if (!classes.includes("tt-card")) continue;
        const tag = src.slice(m.index, src.indexOf(">", m.index));
        const inline = /style=\{\{[^}]*\bpadding\b/.test(tag);
        if (!inline && !classes.some(c => c !== "tt-card" && padded(c))) offenders.push(`${file}: "${m[1]}"`);
      }
    }
    expect(files.some(f => read(f).includes('"tt-card')), "the scan found no card at all").toBe(true);
    expect(offenders, `a card with nothing between its border and its words:\n${offenders.join("\n")}`).toEqual([]);
  });
});

describe("the stylesheet parses", () => {
  it("closes every block it opens", () => {
    // A merge that kept both sides of a conflict in globals.css dropped one
    // closing brace. tsc, lint and every unit test passed; the dev server
    // could not compile the stylesheet and every page answered 500. Counted
    // outside comments, the braces must balance and never go below zero.
    const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0;
    let line = 1;
    const negative: number[] = [];
    for (const ch of css) {
      if (ch === "\n") line++;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth < 0) {
        negative.push(line);
        depth = 0;
      }
    }
    expect(negative, "a } with no block to close, near these lines").toEqual([]);
    expect(depth, "blocks opened and never closed").toBe(0);
  });
});
