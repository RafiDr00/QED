import { Layout } from "./Layout.js";
import { href } from "./base.js";

/**
 * The 404. Short, exact, no adjectives - and it says what to do next rather
 * than apologising.
 */
export function NotFound() {
  return (
    <Layout current="home">
      <section className="qed-section">
        <div className="qed-page">
          <h1 className="t-display-sm">Nothing here</h1>
          <p className="t-lede qed-prose web-hero-lede">
            That page does not exist. The documentation is the best place to
            start.
          </p>
          <p className="web-404-actions">
            <a className="qed-button" data-variant="primary" href={href("docs/")}>
              Read the docs
            </a>{" "}
            <a className="qed-button" data-variant="secondary" href={href("")}>
              Home
            </a>
          </p>
        </div>
      </section>
    </Layout>
  );
}
