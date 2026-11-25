import React from "react";
import type { Metadata } from "next";
import { readDigestStopToken } from "@/lib/digest-stop-token";
import { isLocale, messagesFor } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function StopDigestPage({ searchParams }: {
  searchParams: Promise<{ t?: string | string[]; stopped?: string; lang?: string }>;
}) {
  const { t, stopped, lang } = await searchParams;
  const token = typeof t === "string" ? t : null;
  const recipient = readDigestStopToken(token);
  const copy = messagesFor(recipient?.locale ?? (isLocale(lang) ? lang : await getLocale())).digest;

  return <div className="tt-login"><div className="container"><section className="tt-login-card">
    <h1 className="tt-serif">{copy.stopTitle}</h1>
    {stopped === "1" ? <p role="status">{copy.stopped}</p>
      : recipient && token ? <form method="post" action={`/api/digest/opt-out?t=${encodeURIComponent(token)}`}>
        <button type="submit" name="stopDigest" value="1" className="tt-btn tt-btn-primary">{copy.stopAction}</button>
      </form> : <p role="status">{copy.invalidLink}</p>}
  </section></div></div>;
}
