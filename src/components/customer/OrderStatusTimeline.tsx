"use client";

import type { OrderStatus } from "@/lib/types";
import { useT } from "@/lib/i18n/context";
import {
  StatusPreparingIcon,
  StatusReadyIcon,
  StatusReceivedIcon,
} from "@/components/ui/icons";

const STEPS = [
  { key: "received", labelKey: "tracker.stepReceived", Glyph: StatusReceivedIcon },
  { key: "preparing", labelKey: "tracker.stepPreparing", Glyph: StatusPreparingIcon },
  { key: "ready", labelKey: "tracker.stepReady", Glyph: StatusReadyIcon },
] satisfies { key: OrderStatus; labelKey: string; Glyph: typeof StatusReadyIcon }[];

/** The three-step progress tracker (Received → Preparing → Ready) plus its footer note. */
export default function OrderStatusTimeline({
  status,
  tableLabel,
}: {
  status: OrderStatus;
  tableLabel: string | null;
}) {
  const t = useT();
  const activeIndex = STEPS.findIndex(s => s.key === status);
  const isReady = status === "ready";

  return (
    <div className="tt-card" style={{ padding: 20 }}>
      <div className="tt-tracker">
        {STEPS.map((step, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          return (
            <div key={step.key} className="tt-step-wrap">
              <div className="tt-step">
                <div
                  className={`tt-step-dot ${active ? "tt-step-active" : done ? "tt-step-done" : ""}`}
                >
                  <step.Glyph size={20} weight="bold" />
                </div>
                <span
                  className={`tt-step-label ${
                    active ? "tt-step-label-active" : done ? "tt-step-label-done" : ""
                  }`}
                >
                  {t(step.labelKey)}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`tt-step-line ${done ? "tt-step-line-done" : ""}`} />
              )}
            </div>
          );
        })}
      </div>
      {isReady ? (
        <div
          style={{
            textAlign: "center",
            marginTop: 16,
            fontSize: 14,
            fontWeight: 700,
            color: "var(--tt-success)",
          }}
        >
          {t("tracker.readyTable", { label: tableLabel ?? "" })}
        </div>
      ) : (
        <div
          className="tt-muted"
          style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}
        >
          {t("tracker.wait")}
        </div>
      )}
    </div>
  );
}
