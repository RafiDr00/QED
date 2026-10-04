import {
  Card,
  Label,
  Logo,
  TerminalOutput,
  VerdictChip,
  VerdictTable,
} from "@qed/ui";

import { Layout } from "./Layout.js";
import {
  HERO_RUN,
  MEASURES,
  STEPS,
  TIERS,
  VERDICT_EXAMPLES,
  VERDICT_NOTES,
} from "./content.js";

export function Home() {
  return (
    <Layout current="home">
      <section className="web-hero">
        <div className="qed-page">
          <Logo variant="lockup" size="lg" title="QED" />
          <h1 className="t-display web-hero-line">Proven, or it says so.</h1>
          <p className="t-lede web-hero-lede">
            QED runs the function you changed against the one it replaces, on
            inputs it generates, under controls it records. It answers with one
            of three verdicts and the evidence behind it.
          </p>
          <div className="web-hero-terminal">
            <TerminalOutput result={HERO_RUN} />
          </div>
        </div>
      </section>

      <section className="qed-section" id="measures">
        <div className="qed-page">
          <h2 className="qed-visually-hidden">Published limits</h2>
          <ul className="qed-grid">
            {MEASURES.map((measure) => (
              <li key={measure.label}>
                <Card as="div">
                  <p className="t-numeral web-measure-value">{measure.value}</p>
                  <p className="web-measure-label">
                    <Label>{measure.label}</Label>
                  </p>
                  <p className="t-body-sm qed-prose">{measure.note}</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="qed-section" id="how">
        <div className="qed-page">
          <div className="qed-section-heading">
            <h2 className="t-display-sm">How it works</h2>
          </div>
          <ol className="web-steps">
            {STEPS.map((step) => (
              <li key={step.n} className="web-step">
                <p className="t-mono-sm web-step-n">{step.n}</p>
                <div>
                  <h3 className="t-heading">{step.title}</h3>
                  <p className="t-body qed-prose">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="qed-section" id="verdicts">
        <div className="qed-page">
          <div className="qed-section-heading">
            <h2 className="t-display-sm">The three verdicts</h2>
          </div>
          <p className="t-body qed-prose web-verdicts-lede">
            Each state owns a glyph as well as a colour, so a run survives a
            colour-blind reader, a terminal with colour off, and the
            black-and-white printout an assessor actually reads.
          </p>

          <ul className="web-verdict-notes">
            {VERDICT_NOTES.map((note, index) => {
              const example = VERDICT_EXAMPLES.find(
                (run) => run.verdict.state === note.state,
              );
              return (
                <li key={note.state}>
                  <Card as="div">
                    {example ? <VerdictChip verdict={example.verdict} /> : null}
                    <h3 className="t-heading web-verdict-title">{note.title}</h3>
                    <p className="t-body-sm qed-prose">{note.body}</p>
                    <p className="qed-visually-hidden">
                      Example {index + 1} of {VERDICT_NOTES.length}.
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>

          <div className="web-verdict-table">
            <VerdictTable
              caption="One run, three verdicts"
              captionVisible
              runs={VERDICT_EXAMPLES}
            />
          </div>
        </div>
      </section>

      <section className="qed-section" id="pricing">
        <div className="qed-page">
          <div className="qed-section-heading">
            <h2 className="t-display-sm">Pricing</h2>
          </div>
          <ul className="qed-grid">
            {TIERS.map((tier) => (
              <li key={tier.name}>
                <Card as="div">
                  <h3 className="t-heading">{tier.name}</h3>
                  <p className="t-numeral web-tier-price">{tier.price}</p>
                  <p className="t-mono-sm web-tier-unit">{tier.unit}</p>
                  <p className="t-body-sm qed-prose web-tier-summary">
                    {tier.summary}
                  </p>
                  <ul className="web-tier-list">
                    {tier.includes.map((line) => (
                      <li key={line} className="t-body-sm web-tier-item">
                        {line}
                      </li>
                    ))}
                  </ul>
                  <a
                    className="qed-button web-tier-cta"
                    data-variant={tier.primary === true ? "primary" : "secondary"}
                    href="/docs/#install"
                  >
                    {tier.price === "Talk to us" ? "Contact sales" : "Start"}
                  </a>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Layout>
  );
}
