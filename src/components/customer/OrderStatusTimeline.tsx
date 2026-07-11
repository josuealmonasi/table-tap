import type { OrderStatus } from "@/lib/types";

const STEPS: { key: OrderStatus; label: string; emoji: string }[] = [
  { key: "received", label: "Order Received", emoji: "📋" },
  { key: "preparing", label: "Preparing", emoji: "👨‍🍳" },
  { key: "ready", label: "Ready!", emoji: "🍱" },
];

/** The three-step progress tracker (Received → Preparing → Ready) plus its footer note. */
export default function OrderStatusTimeline({
  status,
  tableLabel,
}: {
  status: OrderStatus;
  tableLabel: string | null;
}) {
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
                  {step.emoji}
                </div>
                <span
                  className={`tt-step-label ${
                    active ? "tt-step-label-active" : done ? "tt-step-label-done" : ""
                  }`}
                >
                  {step.label}
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
          🎉 Our team will bring it to Table {tableLabel}!
        </div>
      ) : (
        <div
          className="tt-muted"
          style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}
        >
          ⏱ Estimated wait: 15–20 min
        </div>
      )}
    </div>
  );
}
