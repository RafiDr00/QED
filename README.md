# QED

**∎ Proven, or it says so.**

The product surfaces, built from the [QED design
system](https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B). The system is the
spec: where code and the system disagree, the system wins, and every place they
could not both be satisfied is written down in [DECISIONS.md](DECISIONS.md).

```
pnpm install
pnpm exec playwright install --with-deps chromium   # once
pnpm verify                                          # the definition of done
```

## What is here

| Package | |
| --- | --- |
| `packages/tokens` | `tokens.json` → CSS custom properties and typed references. Generated; never hand-written. |
| `packages/ui` | React component library. No runtime CSS-in-JS. Its React-free half is exported as `@qed/ui/model`. |
| `packages/cli-render` | A pure function: run result in, ANSI string out. No I/O, no clock. |
| `packages/engine` | The verifier: runs both versions of a function in a sandbox on generated inputs and returns a verdict. Reads no clock and no git. |
| `packages/cli` | `qed check`, `qed repro`, `qed verify`. Reads the diff from git, writes the records. |
| `examples/ledger` | The code the published run is made from: `pnpm generate:run` executes the engine over it. |
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

Each gate lives in its own file under `scripts/gates/`, with its exemptions and
the reason for each beside the code that applies them. `scripts/verify.ts` only
decides what to run. Nothing is skipped quietly.

## What the gates do not catch

A gate that is trusted beyond what it checks is worse than no gate. For each
one, a realistic violation of the property it names that would still pass:

| | Blind spot |
| --- | --- |
| **G1** | It sweeps the resting page, every hover state, every focus state, and the verdict glyphs' SVG fills. `:active` colours are still unmeasured — forcing them needs a held pointer. |
| **visual baselines** | 80 PNGs, two platforms, about 2MB. Every visual change rewrites them and git keeps each version, so this grows. If it becomes a problem the fix is to keep Linux baselines only and let CI be the enforcement point — not worth the churn today, but worth knowing. |
| **G2** | It reads source files. A design value computed at runtime, or passed in as a number and turned into a length in JS, never appears in a file it scans. |
| **G3** | It reads built CSS. A length set through an inline `style` attribute, or hidden inside a `calc()`, is not on the grid it checks. |
| **G4** | It proves the viewBox, every path and every rect are verbatim. It says nothing about the transform around them — but G5 measures the render, and a mirrored or rotated mark fails four of its checks. |
| **G5** | It measures the cut, its 45° angle, the corner radius, the variant and the orientation at the four declared sizes. A mark drawn at some other size, or on a ground that swallows it, is never looked at. |
| **G6** | It proves the two themes differ, that neither shot is blank, and that Void is the darker one. It still cannot tell a correct palette from a wrong one — a theme that swapped `proof` and `break` would pass. |
| **G7** | It proves each negative test fails with at least the number of errors the file declares. An illegal state nobody wrote a case for is still unguarded. |
| **G8** | axe finds a minority of WCAG failures. It does not judge focus order, whether a label is a good label, or whether the page makes sense. The keyboard walkthrough in `flows.spec.ts` covers some of that; a reader covers the rest. |
| **G9** | It budgets JavaScript. The stylesheet, the four woff2 files and every image are unbudgeted — the marketing site ships ~80KB of fonts against 880 bytes of script. |
| **G10** | It compares glyph shapes registered on their ink, and reads the printed DOM back. It never inspects the PDF's own content: that it says the right words, or paginates sanely. |


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
| `pnpm generate:run` | Re-run the engine over `examples/ledger` and rewrite the run both apps display. |
| `pnpm qed <command>` | The CLI from source, through tsx. |
| `pnpm build:cli` | Bundle the CLI into one file, `packages/cli/dist/qed.cjs`. |
| `pnpm build:binary` | Wrap that into a single executable for this machine, `dist/bin/qed-<platform>-<arch>`. |

## The CLI

```
pnpm qed check --base origin/main [--inputs 1000] [--tolerance float=1e-9,rel=1e-12] [--records <dir>]
pnpm qed repro <file> <symbol> --input '<json-array>' [--base <ref>]
pnpm qed verify --digest <sha256, or 16+ hex characters of it>
```

`check` writes one record per function to `.qed/records/`, named by digest,
and prints every digest on stderr so the run's log keeps a copy the records
cannot rewrite. `verify` re-derives a record's digest from its own fields with
the same function the console's Verify button uses, and compares it with the
one you hold. Records are not signed: the signer reads `unsigned` and the
Rekor index `not logged` until OIDC signing and Rekor logging are built.

Exit codes: 0 nothing diverged (or the record verified), 1 something diverged
(or the record was altered), 2 the run could not start or finish.

## Releasing the CLI

`.github/workflows/release.yml` runs on a `v*` tag, or by hand with an existing
tag. It builds the binary on Linux x64/arm64, macOS arm64/x64 and Windows x64,
makes each one run a real check over `examples/ledger` and verify a record it
wrote, and publishes them to GitHub Releases with `SHA256SUMS`. The tag must
match `packages/cli/package.json`, because that version is the engine every
record names.

`apps/web/public/install.sh` is served from the site root. It downloads the
binary for the machine, checks it against `SHA256SUMS`, runs it, and only then
installs it. `QED_VERSION`, `QED_INSTALL_DIR` and `QED_DOWNLOAD_BASE` override
the release, the destination and the source. Until a release is published, it
has nothing to install.

## CI

`.github/workflows/verify.yml` runs `pnpm verify` on every push and pull
request — the same command, the same ten gates. The ESLint rule that rejects a
hex, px or `rgb()` literal outside `packages/tokens` fails the build there.

## Visual regression

Baselines live in `tests/e2e/visual.spec.ts-snapshots/` and are committed, for
Windows and for Linux, so the gate runs locally *and* in CI against a baseline
nobody wrote during the run.

Accept a deliberate change locally with `pnpm e2e --update-snapshots`, then
regenerate the Linux pair by dispatching the `baselines` workflow and copying
its artifact over `tests/e2e/visual.spec.ts-snapshots/`.

## Deploying

`pnpm build` produces two plain static directories — `apps/web/dist` (the
marketing site, HTML + CSS + woff2 and about 1.3KB of inline script) and
`apps/console/dist` (the console demo, a hash-routed SPA). Neither needs a
server, a rewrite rule or a runtime.

Three environment variables tell the build where it will live, so the asset
paths, the in-page links, the canonical URLs and the sitemap all agree:

| | |
| --- | --- |
| `QED_BASE` | path the marketing site is served from. Default `/`. |
| `QED_CONSOLE_BASE` | path the console is served from. Default `/`. |
| `QED_SITE_URL` | origin for canonical URLs, `og:image` and the sitemap. Default `https://qed.dev`. |

`.github/workflows/deploy.yml` publishes both to GitHub Pages on every merge to
`main` — the marketing site at the root, the console demo under `/console/`:

- <https://rafidr00.github.io/QED/>
- <https://rafidr00.github.io/QED/console/>

For a domain of its own, drop the `QED_BASE` variables and set
`QED_SITE_URL=https://qed.dev`.

`pnpm generate:social` regenerates `og.png`, `favicon-32.png` and
`apple-touch-icon.png` from the design system's own logo files and palette —
run it after a change to either.

## Working on it

Design values come from `@qed/tokens` and nowhere else. If you need a value the
system states in prose but does not carry in `tokens.json`, add it to
`packages/tokens/src/component-tokens.json` with the sentence it comes from —
do not type it into a component.

Visual baselines live in `tests/e2e/visual.spec.ts-snapshots/` and are
committed. A change that moves a pixel has to be looked at and accepted with
`pnpm e2e --update-snapshots`.
