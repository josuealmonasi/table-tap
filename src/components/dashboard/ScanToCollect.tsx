"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { orderIdFromScan } from "@/lib/scan-target";

/** Chromium exposes a native decoder; Safari does not, hence jsQR below. */
interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => Detector;
  }
}

/**
 * Point the camera at a diner's code and land on their bill.
 *
 * The list and its search are still there and still work — a diner who says
 * their name or reads out their code is served exactly as before. This is for
 * the queue: the person holds up their phone, whoever is collecting points at
 * it, and the till is already on the right order.
 *
 * Native `BarcodeDetector` where it exists, jsQR everywhere else. iPad Safari
 * has no BarcodeDetector, and an iPad at the counter is the case this is for,
 * so the fallback is not optional.
 */
export default function ScanToCollect({ onFound }: { onFound: (orderId: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");

    async function start(): Promise<void> {
      try {
        // The back camera: a till-side tablet is pointed away from its user.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        // Refused, or no camera, or an insecure origin. Say which of those it
        // is not worth guessing — the way out is the same.
        setProblem(t("scan.noCamera"));
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);

      const native = window.BarcodeDetector
        ? new window.BarcodeDetector({ formats: ["qr_code"] })
        : null;

      const read = async (): Promise<void> => {
        if (stopped || !video.videoWidth) {
          frame = requestAnimationFrame(() => void read());
          return;
        }
        let text: string | null = null;
        if (native) {
          const found = await native.detect(video).catch(() => []);
          text = found[0]?.rawValue ?? null;
        } else {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0);
            const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(px.data, px.width, px.height)?.data ?? null;
          }
        }

        const orderId = orderIdFromScan(text);
        if (orderId) {
          setOpen(false);
          onFound(orderId);
          return;
        }
        frame = requestAnimationFrame(() => void read());
      };
      void read();
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      // Release the camera, or the light stays on after the dialog closes.
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [open, onFound, t]);

  return (
    <>
      <button
        type="button"
        className="tt-btn tt-btn-ghost tt-btn-sm"
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
      >
        {t("scan.button")}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth={420} title={t("scan.title")}>
        {problem ? (
          <p className="tt-muted" style={{ fontSize: 14, margin: 0 }}>
            {problem}
          </p>
        ) : (
          <>
            <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
              {t("scan.hint")}
            </p>
            <video ref={videoRef} className="tt-scan-view" muted playsInline />
          </>
        )}
      </Modal>
    </>
  );
}
