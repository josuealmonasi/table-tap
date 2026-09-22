import { describe, expect, it } from "vitest";
import jsQR from "jsqr";
import { qrSvg } from "@/lib/qr";

/**
 * The QR on the table is the front door of the whole product. One that scans
 * to the wrong address sends every diner at that table somewhere else, and
 * nobody finds out until a restaurant asks why the table never orders.
 *
 * So the test reads the code back — from the SVG `qrSvg` actually returns,
 * which is the thing a restaurant prints, and with `jsqr`, the library the
 * waiter's scanner uses. The first version of this built its code with
 * `QRCode.create` and decoded THAT, which proved the library round-trips and
 * said nothing about our own function. It would have passed with `qrSvg`
 * producing anything at all.
 */
function rasterise(svg: string): { pixels: Uint8ClampedArray; size: number } {
  const box = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1]);
  const d = /<path stroke="[^"]+" d="([^"]+)"/.exec(svg)?.[1] ?? "";
  const dark: boolean[][] = Array.from({ length: box }, () => Array(box).fill(false));
  // `M x y` starts a row, `h n` paints n modules, `m dx dy` steps over light
  // ones. Each stroke runs through the MIDDLE of its row, hence the half.
  let x = 0;
  let y = 0;
  for (const [, cmd, a, b] of d.matchAll(/([Mhm])\s*(-?[\d.]+)(?:\s+(-?[\d.]+))?/g)) {
    if (cmd === "M") { x = Number(a); y = Number(b); }
    else if (cmd === "m") { x += Number(a); y += Number(b); }
    else {
      for (let i = 0; i < Number(a); i++) dark[Math.floor(y)][x + i] = true;
      x += Number(a);
    }
  }
  const scale = 8;
  const quiet = 4; // extra light margin, as a printed card has round it
  const size = (box + quiet * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < box; r++) {
    for (let c = 0; c < box; c++) {
      if (!dark[r][c]) continue;
      for (let py = 0; py < scale; py++) {
        for (let px = 0; px < scale; px++) {
          const i = (((r + quiet) * scale + py) * size + (c + quiet) * scale + px) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        }
      }
    }
  }
  return { pixels, size };
}

async function scan(text: string): Promise<string | null> {
  const { pixels, size } = rasterise(await qrSvg(text));
  return jsQR(pixels, size, size)?.data ?? null;
}

describe("a table's QR scans to the table", () => {
  it("reads back exactly the address it was made from", async () => {
    const table =
      "https://table-tap-star.vercel.app/r/a998ba45-9f7a-4e07-943e-fcbe4efb8be6/t/1c5e8962-d787-42dd-b9e9-6a86095ea9e0";
    expect(await scan(table)).toBe(table);
  });

  it("holds for a hundred different tables", async () => {
    // Every restaurant and every table id is a uuid, so the addresses are all
    // the same length and shape — which is exactly when an encoding mistake
    // would repeat on every one of them.
    const misses: string[] = [];
    for (let i = 0; i < 100; i++) {
      const url = `https://table-tap-star.vercel.app/r/${crypto.randomUUID()}/t/${crypto.randomUUID()}`;
      if ((await scan(url)) !== url) misses.push(url);
    }
    expect(misses).toEqual([]);
  });
});

describe("the SVG a restaurant prints", () => {
  it("is a real SVG with its own white ground", async () => {
    // White behind it, so it still scans printed on a dark tablecloth or a
    // coloured menu card.
    const svg = await qrSvg("https://example.test/r/x");
    expect(svg.trim().startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg.toLowerCase()).toContain("#ffffff");
    expect(svg.toLowerCase()).toContain("#0f0f0f");
  });

  it("is different for a different table", async () => {
    const a = await qrSvg("https://example.test/r/x/t/1");
    const b = await qrSvg("https://example.test/r/x/t/2");
    expect(a).not.toBe(b);
  });
});
