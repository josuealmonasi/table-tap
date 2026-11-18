"use client";

import { PRIVACY_PATH } from "@/lib/legal";
import { SEP } from "@/lib/separator";
import { useT } from "@/lib/i18n/context";
import type { PlaceIdentity as Identity } from "@/lib/place-identity";

interface PlaceIdentityProps {
  identity: Identity | null | undefined;
}

/** Who the diner is paying and where to read how their data is used. Quiet on purpose. */
export default function PlaceIdentity({ identity }: PlaceIdentityProps) {
  const t = useT();
  if (!identity) return null;
  return (
    <p className="tt-place-identity">
      <strong>{identity.name}</strong>
      {identity.address && <>{SEP}{identity.address}</>}
      {SEP}
      <a href={PRIVACY_PATH} target="_blank" rel="noreferrer">{t("placeIdentity.privacy")}</a>
    </p>
  );
}
