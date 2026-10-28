"use client";

import type { JSX } from "react";
import { useId, useState } from "react";
import { useT } from "@/lib/i18n/context";

interface Props { busy: boolean; onStart: (people: number) => Promise<void> }
export default function SplitStart({ busy, onStart }: Props): JSX.Element {
  const t = useT();
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [people, setPeople] = useState(2);
  return <div className="tt-split">
    <label className="tt-split-ask">
      <input type="checkbox" checked={asking} disabled={busy} onChange={e => setAsking(e.target.checked)} />
      <span>{t("split.ask")}</span>
    </label>
    {asking && <>
      <p className="tt-muted">{t("slots.startHint")}</p>
      <label className="tt-mod-label" htmlFor={id}>{t("split.people")}</label>
      <select id={id} className="tt-input" value={people} disabled={busy} onChange={e => setPeople(Number(e.target.value))}>
        {Array.from({ length: 19 }, (_, n) => n + 2).map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <button type="button" className="tt-btn tt-btn-primary" disabled={busy} onClick={() => onStart(people)}>
        {t("slots.start", { n: people })}
      </button>
    </>}
  </div>;
}
