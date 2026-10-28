"use client";

import type { JSX } from "react";
import type { ComponentProps } from "react";
import LegacySplitBillCard from "./LegacySplitBillCard";
import SplitStart from "./SplitStart";
import SplitSlotsCard from "./SplitSlotsCard";

interface Props extends Omit<ComponentProps<typeof LegacySplitBillCard>, "onPay"> {
  onPay: (slots?: number[], tipCents?: number) => void;
  resize?: (people: number) => Promise<void>;
}

/** Old phone claims keep their flow; new divisions belong to people, not devices. */
export default function SplitBillCard(props: Props): JSX.Element | null {
  if (!props.split) return props.outstanding > 0
    ? <SplitStart busy={props.busy} onStart={props.propose} /> : null;
  if (props.split.modelVersion !== 2) return <LegacySplitBillCard {...props} onPay={() => props.onPay()} />;
  return <SplitSlotsCard key={`${props.split.id}:${props.split.revision}`} {...props} split={props.split} />;
}
