"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useT } from "@/lib/i18n/context";

/** A crumb is either a translation key (labelKey) or a literal label (e.g. a menu name). */
export type Crumb = { label?: string; labelKey?: string; href?: string };

/**
 * Page-location breadcrumbs (e.g. Dashboard / Menu). The last crumb is the
 * current page and is never a link. Doubles as the page heading — pages no
 * longer repeat the same word in an <h1>.
 */
export default function Breadcrumb({ trail }: { trail: Crumb[] }) {
  const t = useT();
  const text = (c: Crumb) => (c.labelKey ? t(c.labelKey) : (c.label ?? ""));
  return (
    <nav className="tt-breadcrumb" aria-label="Breadcrumb">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span className="tt-breadcrumb-sep">/</span>}
            {c.href && !last ? (
              <Link href={c.href}>{text(c)}</Link>
            ) : (
              <span
                className="tt-breadcrumb-current"
                aria-current={last ? "page" : undefined}
              >
                {text(c)}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
