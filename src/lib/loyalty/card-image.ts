// ============================================================================
// The visit card as an image the diner saves to their photos.
//
// Drawn in the browser, on a canvas: the phone has the emoji a restaurant uses
// as its mark and the fonts the page is set in, and a server has neither. What
// is drawn is the card's face — `cardFace()` — and nothing else, so an Apple or
// Google Wallet card later is one more way of drawing the same thing.
//
// 1080 × 1350: a phone photo, portrait, big enough to print, small enough to
// send. The QR carries the rewards link; the code is printed under it in
// groups of four, for the day the camera will not read it.
// ============================================================================
import type { CardFace } from "@/lib/loyalty/face";
import type { QrGrid } from "@/lib/loyalty/qr-grid";

export interface CardLabels {
  title: string;
  /** "8 visits = Free dessert", one per reward on the card, already worded. */
  rewardLines: string[];
  /** "Show this card on each visit". */
  showIt: string;
  /** "Check your progress at tabletap.mx/rewards". */
  checkAt: string;
}

const W = 1080;
const H = 1350;

/** A token of the page's own palette, so the card is drawn in the app's colours. */
function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    // A logo on another host has to allow it, or the canvas refuses to export;
    // the emoji or the initial is drawn instead.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, size: number, weight: string): void {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${getComputedStyle(document.body).fontFamily}`;
    s -= 2;
  } while (ctx.measureText(text).width > maxWidth && s > 18);
}

export async function drawCard(face: CardFace, qr: QrGrid, labels: CardLabels): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");

  const ink = token("--tt-ink", "#111113");
  const accent = token("--tt-accent", "#0e6e6e");
  const accentInk = token("--tt-accent-ink", "#ffffff");
  const paper = token("--tt-white", "#ffffff");
  const muted = token("--tt-muted", "#70707a");

  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, W, H);

  // The band: the restaurant's mark and name, in the accent.
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 330);
  const logo = face.logoUrl ? await loadImage(face.logoUrl) : null;
  ctx.save();
  ctx.beginPath();
  ctx.arc(W / 2, 120, 72, 0, Math.PI * 2);
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.clip();
  if (logo) ctx.drawImage(logo, W / 2 - 72, 48, 144, 144);
  else {
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `84px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillText(face.logoEmoji ?? face.restaurantName.slice(0, 1).toUpperCase(), W / 2, 126);
  }
  ctx.restore();
  ctx.fillStyle = accentInk;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  fitText(ctx, face.restaurantName, W - 120, 64, "800");
  ctx.fillText(face.restaurantName, W / 2, 272);

  // What it is, and what it earns.
  ctx.fillStyle = ink;
  fitText(ctx, labels.title, W - 160, 52, "700");
  ctx.fillText(labels.title, W / 2, 420);
  // One reward is one line, as the card has always read. A ladder takes a
  // line per reward, and the QR gives up the room: a smaller QR still scans,
  // a reward nobody can read is not on the card.
  ctx.fillStyle = muted;
  const lines = labels.rewardLines.slice(0, 4);
  const lineGap = lines.length > 1 ? 50 : 0;
  lines.forEach((line, i) => {
    fitText(ctx, line, W - 160, lines.length > 1 ? 36 : 40, "500");
    ctx.fillText(line, W / 2, 480 + i * lineGap);
  });
  const shift = lineGap * Math.max(0, lines.length - 1);

  // The QR, drawn module by module from the grid the server sent: no image to
  // load, nothing to taint, and no QR library shipped to the phone.
  const size = qr.size;
  const box = 560 - shift;
  const cell = Math.floor(box / (size + 8));
  const drawn = cell * size;
  const x0 = Math.round((W - drawn) / 2);
  const y0 = 540 + shift + Math.round((box - drawn) / 2);
  ctx.fillStyle = paper;
  ctx.fillRect(x0 - cell * 4, y0 - cell * 4, drawn + cell * 8, drawn + cell * 8);
  ctx.fillStyle = ink;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.bits[r * size + c] === "1") ctx.fillRect(x0 + c * cell, y0 + r * cell, cell, cell);
    }
  }

  // The code, for the day the camera will not read it.
  ctx.fillStyle = ink;
  ctx.font = `700 64px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(face.printedCode, W / 2, 1180);
  ctx.fillStyle = muted;
  fitText(ctx, labels.showIt, W - 160, 34, "500");
  ctx.fillText(labels.showIt, W / 2, 1245);
  fitText(ctx, labels.checkAt, W - 160, 30, "400");
  ctx.fillText(labels.checkAt, W / 2, 1295);

  return await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("could not draw the card"))), "image/png"),
  );
}
