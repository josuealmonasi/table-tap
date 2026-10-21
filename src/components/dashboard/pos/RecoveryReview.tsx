"use client";
import { useEffect, useState } from "react";
import RecoveryForm, { type RecoveryFormProps } from "./RecoveryForm";
import type { OfflineComparison } from "@/lib/offline-comparison";

/** Fetch only the selected receipt's comparison, so a long queue stays cheap. */
export default function RecoveryReview(props: RecoveryFormProps) {
  const [comparison, setComparison] = useState<OfflineComparison | null>(null);
  const [comparing, setComparing] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const res = await fetch(`/api/pos/recover?posRef=${encodeURIComponent(props.sale.posRef)}`, { signal: controller.signal, cache: "no-store" });
        if (!res.ok) throw new Error("Could not compare saved sale");
        const data = await res.json();
        if (!controller.signal.aborted) setComparison(data.comparison ?? null);
      } catch { if (!controller.signal.aborted) setComparison(null); }
      finally { if (!controller.signal.aborted) setComparing(false); }
    }
    void load();
    return () => controller.abort();
  }, [props.sale.posRef]);
  return <RecoveryForm {...props} comparison={comparison} comparing={comparing} />;
}
