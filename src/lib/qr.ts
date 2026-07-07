import QRCode from "qrcode";

/**
 * Renders a QR code for `text` as an inline SVG string. Server-side only, so the
 * QR library never ships to the client. Callers embed the result directly.
 */
export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    width: 220,
    color: { dark: "#0f0f0f", light: "#ffffff" }, // white bg so it scans on any surface
  });
}
