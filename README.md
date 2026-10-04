# QED

**∎ Proven, or it says so.**

The product surfaces, built from the [QED design
system](https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B). The system is the
spec: where code and the system disagree, the system wins, and every place they
could not both be satisfied is written down in [DECISIONS.md](DECISIONS.md).

```
pnpm install
pnpm verify      # the definition of done
```

## What is here

| Package | |
| --- | --- |
| `packages/tokens` | `tokens.json` → CSS custom properties and typed references. Generated; never hand-written. |
| `packages/ui` | React component library. No runtime CSS-in-JS. Its React-free half is exported as `@qed/ui/model`. |
| `packages/cli-render` | A pure function: run result in, ANSI string out. No I/O, no clock. |
| `apps/web` | The marketing site. Prerendered to static HTML — React runs at build time only. |
| `apps/console` | The product shell: run, verdicts, attestations, release evidence, audit export. Typed fixtures, no network. |
| `tests/gallery` | The component index the evidence run shoots. Never shipped. |

## The rules the build enforces

`pnpm verify` builds, typechecks, lints, runs the tests, produces fresh
evidence with Playwright, and then evaluates ten gates. It exits non-zero on any
failure.

| | |
| --- | --- |
| **G1** | WCAG ratio for every text/background pair the UI actually uses, in both themes — computed from `tokens.json` and swept again across 438 rendered text nodes. |
| **G2** | No hex, `rgb()`, px or rem literal outside `packages/tokens`, and none of the effects the brand book forbids. ESLint fails on the same thing while you type. |
| **G3** | Every line-height, spacing and radius in the built CSS is on the 4px grid, or one of five listed exceptions. |
| **G4** | The shipped logo path data is byte-identical to the design system's. |
| **G5** | The mark renders at 16/24/32/48px, uses the right optical variant at each, and its cut still reads. |
| **G6** | Every component is shot in both themes, and neither is blank nor identical to the other. |
| **G7** | A verdict without its evidence does not compile. Eight files that must fail, two that must not. |
| **G8** | axe-core, zero violations, every route, both themes. |
| **G9** | The marketing site ships under 40KB of gzipped JS. It currently ships 880 bytes. |
| **G10** | The attestation renders to PDF, and the three verdict glyphs stay apart in greyscale — at full size and at the 9px they ship at. |

Each gate names its own exemptions in `scripts/verify.ts`, with the reason, in
the file. Nothing is skipped quietly.

## Scripts

| | |
| --- | --- |
| `pnpm verify` | Everything above. |
| `pnpm verify --no-run` | Evaluate the gates against existing output. |
| `pnpm build` | Tokens, the logo module, both apps. |
| `pnpm test` | Vitest: unit, behaviour and property tests. |
| `pnpm e2e` | Playwright: evidence, flows, visual regression. |
| `pnpm measure:fonts` | Re-measure the metric-matched fallbacks. Fails above a 1% residual shift. |
| `pnpm build:logos` | Regenerate the typed logo module from the SVGs. |

## Working on it

Design values come from `@qed/tokens` and nowhere else. If you need a value the
system states in prose but does not carry in `tokens.json`, add it to
`packages/tokens/src/component-tokens.json` with the sentence it comes from —
do not type it into a component.

Visual baselines live in `tests/e2e/visual.spec.ts-snapshots/` and are
committed. A change that moves a pixel has to be looked at and accepted with
`pnpm e2e --update-snapshots`.
