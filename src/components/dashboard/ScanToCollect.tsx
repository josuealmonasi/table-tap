"use client";

import { useT } from "@/lib/i18n/context";
import QrScanner from "./QrScanner";
import { orderIdFromScan } from "@/lib/scan-target";

/**
 * Point the camera at a diner's code and land on their bill.
 *
 * The list and its search are still there and still work — a diner who says
 * their name or reads out their code is served exactly as before. This is for
 * the queue: the person holds up their phone, whoever is collecting points at
 * it, and the till is already on the right order.
 */
export default function ScanToCollect({ onFound }: { onFound: (orderId: string) => void }) {
  const t = useT();
  return (
    <QrScanner
      label={t("scan.button")}
      title={t("scan.title")}
      hint={t("scan.hint")}
      noCamera={t("scan.noCamera")}
      onRead={raw => {
        const orderId = orderIdFromScan(raw);
        // Anything else in front of the lens is not an error; it is a poster.
        if (!orderId) return "keep-looking";
        onFound(orderId);
        return "taken";
      }}
    />
  );
}
