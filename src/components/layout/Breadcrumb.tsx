import { Fragment } from "react";
import Link from "next/link";

export type Crumb = { label: string; href?: string };

/**
 * Page-location breadcrumbs (e.g. Dashboard / Menu). The last crumb is the
 * current page and is never a link. Doubles as the page heading — pages no
 * longer repeat the same word in an <h1>.
 */
export default function Breadcrumb({ trail }: { trail: Crumb[] }) {
  return (
    <nav className="tt-breadcrumb" aria-label="Breadcrumb">
      {trail.map((c, i) => {
        const last = i === trail.length - 1;
        return (
          <Fragment key={i}>
            {i > 0 && <span className="tt-breadcrumb-sep">/</span>}
            {c.href && !last ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <span className="tt-breadcrumb-current" aria-current={last ? "page" : undefined}>
                {c.label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}
