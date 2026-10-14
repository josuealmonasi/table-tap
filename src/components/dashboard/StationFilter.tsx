"use client";

import { useT } from "@/lib/i18n/context";
import { STATIONS, type Station } from "@/lib/stations";

interface StationFilterProps {
  station: Station | null;
  onChange: (station: Station | null) => void;
}

/** Everything, or one station's work: the bar's screen shows the bar. */
export default function StationFilter({ station, onChange }: StationFilterProps) {
  const t = useT();
  const options: (Station | null)[] = [null, ...STATIONS];
  return (
    <div className="tt-station-filter" role="radiogroup" aria-label={t("stations.label")}>
      {options.map(option => (
        <button
          type="button"
          key={option ?? "all"}
          role="radio"
          aria-checked={station === option}
          className={`tt-chip${station === option ? " tt-chip-on" : ""}`}
          onClick={() => onChange(option)}
        >
          {option ? t(`stations.${option}`) : t("stations.all")}
        </button>
      ))}
    </div>
  );
}
