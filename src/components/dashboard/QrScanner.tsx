"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useQrCamera, type ScanVerdict } from "@/hooks/useQrCamera";

export type { ScanVerdict };

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
 * Point the camera at a code and do something with it: a button, and the
 * camera in a dialog. The reading is `useQrCamera`'s; what a code MEANS is the
 * caller's, because a bill and a table are read by the same lens and are not
 * the same question.
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
  const { videoRef, problem, setProblem } = useQrCamera(open, onRead, () => setOpen(false), noCamera);

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
