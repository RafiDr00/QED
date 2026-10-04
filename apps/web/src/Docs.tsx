import { Layout } from "./Layout.js";
import { DOCS_NAV, DOCS_SECTIONS } from "./content.js";

/** The docs shell: a table of contents, and the pages it points at. */
export function Docs() {
  return (
    <Layout current="docs">
      <div className="qed-page web-docs">
        <nav className="web-docs-nav" aria-label="Documentation">
          <h2 className="web-docs-nav-title">
            <span className="t-label">CONTENTS</span>
          </h2>
          <ul>
            {DOCS_NAV.map((item) => (
              <li key={item.id}>
                <a className="web-docs-nav-link t-body-sm" href={`#${item.id}`}>
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="web-docs-body">
          <h1 className="t-display-sm web-docs-title">Documentation</h1>
          <p className="t-lede qed-prose">
            One binary. It reads a diff, runs both versions of each function it
            can run soundly, and prints what it found.
          </p>

          {DOCS_SECTIONS.map((section) => (
            <section key={section.id} id={section.id} className="web-docs-section">
              <div className="qed-section-heading">
                <h2 className="t-heading">{section.title}</h2>
              </div>
              {section.body.map((paragraph) =>
                paragraph.startsWith("qed ") || paragraph.startsWith("curl ") ? (
                  <pre key={paragraph} className="web-docs-code t-mono">
                    <code>{paragraph}</code>
                  </pre>
                ) : (
                  <p key={paragraph} className="t-body qed-prose web-docs-para">
                    {paragraph}
                  </p>
                ),
              )}
            </section>
          ))}
        </article>
      </div>
    </Layout>
  );
}
