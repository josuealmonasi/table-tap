import type { Clause } from "@/lib/legal/terms-es";

/**
 * A legal document, laid out to be read rather than skimmed past.
 *
 * Narrow measure, real paragraph spacing, numbered headings that match how the
 * clauses refer to each other. The version and its date sit at the foot, which
 * is what somebody checks when they want to know which terms they agreed to.
 */
export default function LegalDoc({
  title,
  intro,
  version,
  clauses,
}: {
  title: string;
  intro: string;
  version: string;
  clauses: Clause[];
}) {
  return (
    <div className="tt-root tt-legal">
      <h1 className="tt-serif tt-legal-title">{title}</h1>
      <p className="tt-legal-intro">{intro}</p>

      {clauses.map(clause => (
        <section key={clause.title} className="tt-legal-clause">
          <h2 className="tt-serif">{clause.title}</h2>
          {clause.paragraphs.map(text => (
            <p key={text}>{text}</p>
          ))}
        </section>
      ))}

      <p className="tt-legal-version">{version}</p>
    </div>
  );
}
