"use client";

import { orderCode, type OrderStatus } from "@/lib/types";
import type { TrackedOrder } from "@/lib/order-tracking";
import { useT } from "@/lib/i18n/context";
import OrderStatusTimeline from "./OrderStatusTimeline";
import TrackedItemsCard from "./TrackedItemsCard";
import {
  StatusPreparingIcon,
  StatusReadyIcon,
  StatusReceivedIcon,
} from "@/components/ui/icons";

/** Collapse the full order status into the three stages the diner sees. */
export function toDisplayStatus(status: OrderStatus): OrderStatus {
  if (status === "completed") return "ready";
  if (status === "pending_payment") return "received";
  return status;
}

const HERO: Record<string, { headlineKey: string; Glyph: typeof StatusReadyIcon }> = {
  ready: { headlineKey: "tracker.ready", Glyph: StatusReadyIcon },
  preparing: { headlineKey: "tracker.preparing", Glyph: StatusPreparingIcon },
  received: { headlineKey: "tracker.received", Glyph: StatusReceivedIcon },
};

/**
 * What the diner watches: the headline, the three stages, and what they
 * ordered. No page chrome, because this is shown two ways — as a screen on a
 * phone, and inside a dialog on a wide one — and the parts that differ are
 * exactly the chrome.
 */
export default function TrackerBody({
  order,
  children,
}: {
  order: TrackedOrder;
  /** The way out: a link back to the menu, or a dialog's close button. */
  children?: React.ReactNode;
}) {
  const t = useT();
  const status = toDisplayStatus(order.status);
  const hero = HERO[status] ?? HERO.received;

  return (
    <>
      <div className="tt-track-hero">
        <hero.Glyph size={46} weight="duotone" />
        <h2 className="tt-serif" style={{ margin: 0, fontSize: 22 }}>
          {t(hero.headlineKey)}
        </h2>
        <div className="tt-sage" style={{ fontSize: 13, marginTop: 4 }}>
          {orderCode(order.id)}
          {/* Their own name, if they gave one. They should be able to check
              what the cashier is about to call out, and to see that it was
              taken down correctly. */}
          {order.customer_name && <> · {order.customer_name}</>}
        </div>
      </div>

      <div className="tt-track-body">
        <OrderStatusTimeline status={status} tableLabel={order.table_label} />
        <TrackedItemsCard
          items={order.items}
          total={order.total}
          currency={order.currency}
          paid={order.paid !== false}
        />

        {/* Only while there is something to collect. On a settled order there
            is nothing for anyone to scan, and a payment code on a paid bill
            invites somebody to be charged twice. Placed after the total, which
            is the order it gets used in: this is what you owe, this is how
            they take it. */}
        {order.paid === false && (
          <div className="tt-card tt-pay-qr">
            <strong>{t("tracker.showToPay")}</strong>
            <p className="tt-muted">{t("tracker.showToPayHint")}</p>
            {/* Server-rendered so the QR library never ships to the client, and
                its own route so it is not re-sent with every five-second poll.

                A plain <img>: next/image does not optimise SVG, and pointing it
                at one needs `dangerouslyAllowSVG`, which turns on SVG handling
                for every image in the app to save nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/order-qr?id=${order.id}`}
              alt={t("tracker.showToPay")}
              width={180}
              height={180}
            />
          </div>
        )}

        {children}
      </div>
    </>
  );
}
