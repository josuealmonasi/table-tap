// ============================================================================
// A QR code as a grid of modules, for a browser that draws it itself.
//
// SERVER-ONLY: the QR library stays on the server (see qr.ts). The card image
// is drawn on the diner's phone, so the server hands over the finished grid —
// row after row, "1" for a dark module — and the canvas paints squares.
// ============================================================================
import QRCode from "qrcode";

export interface QrGrid {
  size: number;
  bits: string;
}

export function qrGrid(text: string): QrGrid {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const { size, data } = qr.modules;
  return { size, bits: Array.from(data, b => (b ? "1" : "0")).join("") };
}
