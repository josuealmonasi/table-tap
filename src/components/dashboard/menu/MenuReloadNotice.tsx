"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

interface MenuReloadNoticeProps { reload: () => Promise<void> }

export default function MenuReloadNotice({ reload }: MenuReloadNoticeProps) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  async function retry(): Promise<void> {
    setRetrying(true);
    try { await reload(); } finally { setRetrying(false); }
  }
  return (
    <div role="alert" className="tt-section">
      <p>{t("menu.reloadFailed")}</p>
      <button type="button" className="tt-btn tt-btn-ghost tt-btn-sm" disabled={retrying} onClick={retry}>
        {t(retrying ? "menu.retrying" : "fallback.retry")}
      </button>
    </div>
  );
}
