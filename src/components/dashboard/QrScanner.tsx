"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Modal } from "@/components/ui/Modal";

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
 * What the caller made of a code the camera read.
 *
 * A camera hands back whatever is in front of it — a poster, a wifi card,
 * another restaurant's code — so "not ours" has to be ordinary rather than an
 * error: keep looking, and say nothing. A code that IS ours but cannot be used
 * is the one worth stopping for.
 */
export type ScanVerdict = "taken" | "keep-looking" | { problem: string };

interface QrScannerProps {
  /** What the button says before the camera opens. */
  label: string;
  title: string;
  hint: string;
  /** Copy for a camera that will not open — refused, absent, or plain http. */
  noCamera: string;
  onRead: (raw: string) => ScanVerdict;
  /** Styling for the button, when the surrounding screen wants a different one. */
  buttonClass?: string;
}

/**
 * Point the camera at a code and do something with it.
 *
 * Native `BarcodeDetector` where it exists, jsQR everywhere else. iPad Safari
 * has no BarcodeDetector, and an iPad on a restaurant floor is exactly the case
 * this is for, so the fallback is not optional.
 *
 * The camera and the decoding live here; what a code MEANS is the caller's,
 * because a bill and a table are read by the same lens and are not the same
 * question.
 */
export default function QrScanner({
  label,
  title,
  hint,
  noCamera,
  onRead,
  buttonClass = "tt-btn tt-btn-ghost tt-btn-sm",
}: QrScannerProps) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Read on every frame, so it cannot be a dependency of the effect: a new
  // closure each render would tear the camera down and start it again.
  const handler = useRef(onRead);
  handler.current = onRead;

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");

    async function start(): Promise<void> {
      try {
        // The back camera: a tablet is pointed away from whoever is holding it.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
      } catch {
        // Refused, or no camera, or an insecure origin. Which of those it is is
        // not worth guessing — the way out is the same.
        setProblem(noCamera);
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

        const verdict = text ? handler.current(text) : "keep-looking";
        if (verdict === "taken") {
          setOpen(false);
          return;
        }
        if (typeof verdict === "object") {
          setProblem(verdict.problem);
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
  }, [open, noCamera]);

  return (
    <>
      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          setProblem(null);
          setOpen(true);
        }}
      >
        {label}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} maxWidth={420} title={title}>
        {problem ? (
          <p className="tt-muted" style={{ fontSize: 14, margin: 0 }}>
            {problem}
          </p>
        ) : (
          <>
            <p className="tt-muted" style={{ fontSize: 13, marginTop: 0 }}>
              {hint}
            </p>
            <video ref={videoRef} className="tt-scan-view" muted playsInline />
          </>
        )}
      </Modal>
    </>
  );
}
