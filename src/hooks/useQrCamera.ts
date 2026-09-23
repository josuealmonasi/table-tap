"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

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

/**
 * The back camera, read frame by frame while `active`.
 *
 * Native `BarcodeDetector` where it exists, jsQR everywhere else — iPad Safari
 * has none, and an iPad on a restaurant floor is exactly who this is for. The
 * camera is released the moment `active` goes false, or the light stays on.
 * What a code MEANS is the caller's: `onRead` says whether it was taken.
 */
export function useQrCamera(
  active: boolean,
  onRead: (raw: string) => ScanVerdict,
  onTaken: () => void,
  noCamera: string,
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Read on every frame, so they cannot be dependencies of the effect: a new
  // closure each render would tear the camera down and start it again.
  const handler = useRef(onRead);
  handler.current = onRead;
  const taken = useRef(onTaken);
  taken.current = onTaken;

  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");

    async function start(): Promise<void> {
      try {
        // The back camera: a tablet is pointed away from whoever is holding it.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
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

      const native = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;

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
          taken.current();
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
      stream?.getTracks().forEach(track => track.stop());
    };
  }, [active, noCamera]);

  return { videoRef, problem, setProblem };
}
