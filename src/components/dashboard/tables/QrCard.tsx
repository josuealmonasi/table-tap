"use client";

/** A QR target: the URL it points to and its pre-rendered inline SVG. */
export interface QrTarget {
  url: string;
  svg: string;
}

interface QrCardProps {
  title: string;
  subtitle?: string;
  qr: QrTarget;
  /** Filename (without extension) used when downloading the SVG. */
  downloadName: string;
}

/** Shows a QR code with its target URL and Download / Print actions. */
export default function QrCard({ title, subtitle, qr, downloadName }: QrCardProps) {
  function downloadSvg(): void {
    const blob = new Blob([qr.svg], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${downloadName}.svg`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function printQr(): void {
    const w = window.open("", "_blank", "width=420,height=560");
    if (!w) return;
    w.document.write(
      `<!doctype html><title>${title}</title>` +
        `<body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;` +
        `height:100vh;font-family:system-ui,sans-serif;text-align:center">` +
        `<div style="width:260px">${qr.svg}</div>` +
        `<div style="font-size:20px;font-weight:700;margin-top:12px">${title}</div>` +
        (subtitle ? `<div style="font-size:13px;color:#666;margin-top:2px">${subtitle}</div>` : "") +
        `</body>`
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="tt-qr-card">
      <div className="tt-qr-code" dangerouslySetInnerHTML={{ __html: qr.svg }} />
      <div className="tt-qr-meta">
        <strong>{title}</strong>
        {subtitle && <span className="tt-muted" style={{ fontSize: 13 }}>{subtitle}</span>}
        <a className="tt-qr-url tt-muted" href={qr.url} target="_blank" rel="noreferrer">{qr.url}</a>
        <div className="tt-qr-actions">
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={downloadSvg}>⬇ Download</button>
          <button className="tt-btn tt-btn-ghost tt-btn-sm" onClick={printQr}>🖨 Print</button>
        </div>
      </div>
    </div>
  );
}
