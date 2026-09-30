"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";
import QrScanner from "@/components/dashboard/QrScanner";
import { QrIcon } from "@/components/ui/icons";
import { dinerPathFromScan } from "@/lib/scan-target";

/**
 * The diner's own scanner, beside the search: point it at an account's
 * statement QR to check what is owed and pay it, or at a visit card or a
 * table's code. Only TableTap's own codes are followed, and only to a page of
 * this app (`dinerPathFromScan`): a sticker over a QR can name any site, and
 * this button must never be what sends somebody there.
 */
export default function MenuScanButton() {
  const t = useT();
  const router = useRouter();
  return (
    <QrScanner
      label={t("menu.scan")}
      title={t("menu.scanTitle")}
      hint={t("menu.scanHint")}
      noCamera={t("scan.noCamera")}
      buttonClass="tt-icon-round tt-scan-toggle"
      icon={<QrIcon size={17} weight="bold" />}
      onRead={raw => {
        const path = dinerPathFromScan(raw);
        if (!path) return "keep-looking";
        router.push(path);
        return "taken";
      }}
    />
  );
}
