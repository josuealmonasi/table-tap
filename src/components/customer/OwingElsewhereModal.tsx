"use client";

import { Modal } from "@/components/ui/Modal";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/format";
import type { OpenElsewhere } from "@/hooks/useSitting";

interface OwingElsewhereModalProps {
  /** The other table this phone still owes at, if any. */
  owing: OpenElsewhere | null;
  currency: string;
}

/**
 * Already owing at another table: ordering here would open a second bill
 * beside one nobody has settled.
 *
 * Not dismissible into ordering, on purpose. They can still read the menu
 * behind it, and settling the other table clears this by itself.
 */
export default function OwingElsewhereModal({
  owing,
  currency,
}: OwingElsewhereModalProps) {
  const t = useT();
  return (
    <Modal
      open={Boolean(owing)}
      onClose={() => {}}
      maxWidth={400}
      label={t("sitting.title")}
    >
      <h3 className="tt-serif" style={{ marginTop: 0, marginBottom: 8 }}>
        {t("sitting.title")}
      </h3>
      <p className="tt-muted" style={{ marginTop: 0 }}>
        {t("sitting.body", {
          table: owing?.tableLabel ?? "",
          amount: formatMoney(owing?.owed ?? 0, currency),
        })}
      </p>
      <p className="tt-muted tt-subline" style={{ fontSize: 13 }}>
        {t("sitting.hint")}
      </p>
    </Modal>
  );
}
