# FLAWS — round 3

Adversarial re-review against the QED design system
(<https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B>, version `1791100908-8a30`).

Read first: `project/README.md`, `project/tokens.json`, `project/assets/Logos/*`,
`project/components/{Verdict,Terminal,Attestation,Logotype}/{README.md,preview.html}`.
Then `git show 3b9787a`, `FLAWS.md` §"Resolution — round 2", `DECISIONS.md`,
`pnpm verify --no-run` (10/10 green), the committed snapshots in
`tests/e2e/visual.spec.ts-snapshots/` and the raw evidence in `.verify/`.

---

## What this review did NOT cover

This run was cut short. The following were **not** examined, and absence of a
finding there means nothing:

- `pnpm test` / `pnpm exec playwright test` were **not run**. Only
  `pnpm verify --no-run` was executed (it passed 10/10 against committed evidence).
- **No live rendering at narrow viewports, at 200% zoom, or in RTL.** Every
  narrow-viewport claim below (R-012) is arithmetic from the CSS, marked
  UNCONFIRMED.
- **Screenshots opened:** `TerminalOutput-void`, `TerminalOutputEmpty-paper`,
  `Logo-void`, `VerdictChip-void`, `VerdictTable-void`,
  `VerdictTableLongStrings-void`, `GlyphsLarge-void`, `AttestationMismatch-void`,
  `Attestation-paper`, `FocusRing-void`, plus `.verify/shots/dot9-*`.
  **Not opened:** every other `*-paper` pair, `Button`, `Card`, `Label`, `Table`,
  `TableEmpty`, `VerdictTableEmpty`, `AttestationChecking`, `AttestationVerified`,
  `AttestationNoTolerance`, `LogoMarks`, `GlyphsLarge-paper`.
- **Not read:** `tests/unit/*` in full (only the round-2 diff),
  `packages/cli-render/src/index.ts`, `packages/ui/src/model/{verdict,attestation}.ts`,
  `scripts/{generate-logos,snapshot-logos,measure-fonts,color}.ts`,
  `tests/gallery/gallery.css`, `apps/web/src/Docs.tsx` CSS interactions,
  `eslint.config.js`, the repo `README.md`, `packages/ui/type-tests/*` contents.
- **Copy/voice review is partial**: `apps/web/src/content.ts` was read in full;
  console view copy was skimmed; docs prose was read once.
- **Focus order after an interaction** was reasoned about from source, not driven.
- **Gate blind spots** (§ at the end) are stated for all ten, but only the holes
  in G1/G2/G3/G4/G5/G6/G7/G10 were traced to specific code. G8/G9 holes are
  argued from the gate source alone.

---

## Round-2 fixes: do they hold?

| Round-2 claim | Verdict |
| --- | --- |
| **F-002 composed lockup** (`Logo.tsx`) | **Partial.** Geometry is right (0.78× x-height = 56.16u, gap 30u, baseline-aligned, `translate(281.2 15.84) scale(2.808)` maps the 24-unit art exactly onto that box). But every lockup the product actually ships uses `mark-16`, so the shipped logo never matches `qed-logotype.svg`; the one size that would (`xl`) is used nowhere and tested nowhere. See R-005, R-006. |
| **F-006 80-column terminal** (`terminal.ts`) | **Not fixed — regressed.** At the shipped default of 80 columns the path and the symbol collide with no separator on the marketing home page. See R-001. |
| **F-007 print theme** (`packages/tokens/build.ts`) | **Partial.** `:root:not([data-theme="paper"])` does switch the page vars under print. But the one component-level theme override in the repo is keyed on `[data-theme="paper"]`, which that rule cannot satisfy, so the terminal pane prints on `bg-sunk` at 4.24:1 — the exact failure D-005 exists to prevent. See R-002. |
| **F-003 failed-verification state** (`attestation.css`, D-027) | **Partial.** The CSS and the unit test are real; the state is unreachable in the shipped console, because `App.tsx::verify()` unconditionally resolves to `verified`. See R-003. |
| **F-004 verify reports when it ran** | **Verified** in code (`App.tsx` uses `new Date()`), but the comment in `AttestationsView.tsx` still says the opposite. See R-015. |
| **G4 strengthened** (`verify.ts`) | **Partial.** File bytes are now anchored to the artifact's sha256 — good. But `pathDataOf()` reads `d="…"` only: the wordmark's two `<rect>` stems are in no hash, and transforms/viewBoxes are never checked. See R-009. |
| **G5 strengthened** | **Partial.** Cut fraction and corner-squareness are real checks. The 5.5 % radius, the 45° cut angle, the other three corners and the lockup's embedded mark are all still unchecked. See R-010. |
| **G6 strengthened** | **Partial.** `dimensionsMatch` is a genuine improvement. The ≥10 % threshold is non-binding: every component reports 99.88–100 %. See R-011. |
| **G7 strengthened** | **Not fixed — new proxy.** `expectedErrors` is hard-coded to `1` in `scripts/type-tests.ts:88`, so `actualErrors >= expectedErrors` is still "at least one error of any kind". See R-008. |
| **G10 strengthened** | **Partial.** Reading the printed page back is real and does catch the toggle case. The 9 px glyph comparison it rests on compares misregistered bitmaps; its numbers are artifacts. See R-004, R-002. |
| **F-020 attestation rules → `rule-strong`** | **Not fixed — made it worse in the primary theme.** See R-007. |
| **F-025 FocusRing shot focuses its link** | **Partial.** It put the real treatment in the baseline and the baseline now shows two concentric focus rings. See R-013. |
| **F-009 / D-025 `size` means the mark** | **Partial.** Fixed for `variant="mark"`; the verdict dot has the identical defect and was not touched. See R-014. |

---

# Findings

## BLOCKING

### R-001 · The 80-column terminal runs the path and the symbol together, on the home page

**Where:** `packages/ui/src/model/terminal.ts:147-166`; shipped in
`apps/web/dist/index.html` and `apps/console/src/views/RunView.tsx`.

**Violates:** *"**Three fixed columns** — verdict, path, symbol — then evidence
ragged right in `ink-muted`. Alignment is what makes a long run scannable; a
verdict list that wraps is a verdict list nobody reads."*
(`components/Terminal/README.md`) and *"The CLI output is the product's
most-shared surface, so it is designed as deliberately as any screen."*

**What happens.** When the symbol column alone cannot absorb the excess, the
path column is shrunk too (`terminal.ts:137`). `pad(run.path, pathWidth)` then
does nothing, because `padEnd` never truncates — so the un-padded path is
emitted immediately followed by `run.symbol` with no separator at all.
Rendered from the shipped fixture at the default 80 columns:

```
  ● DIVERGED    ledger/reconciliation/periodic.tsreconcileOutstandingSettlementBatches
```

Verified in the prerendered output:

```html
<span data-tone="ink">ledger/reconciliation/periodic.ts</span><span data-tone="ink">reconcileOutstandingSettlementBatches</span>
```

At 60 columns three more rows collapse the same way
(`orders/pricing.tsapplyDiscount`, `orders/pricing.tsbulkRate`).

**Why two rounds missed it.** The gallery's `TerminalOutput` shot uses the
3-row `RUNS` fixture, not `LONG_RUNS` (`tests/gallery/main.tsx:300`), so there
is no visual baseline for it. And the round-2 unit test written for exactly
this case —
`tests/unit/model.test.ts` *"gives an over-long symbol its own evidence line"* —
replaced the previous round's long-path fixture with two short rows, then used
a case where only the **symbol** overflows. It asserts
`longLine).toContain("reconcileOutstandingSettlementBatches")` and never
asserts there is whitespace before it. The test passes while the output is
unreadable.

**Fix.** In `buildRunLines`, when `overflows` is true, emit the path with a
guaranteed separator rather than relying on `pad`:

```ts
{ text: run.path.length + 2 > pathWidth ? `${run.path}  ` : pad(run.path, pathWidth), tone: "ink" },
```

and add (a) a `TerminalOutputLongStrings` gallery shot fed from `LONG_RUNS`, and
(b) a unit assertion `expect(longLine).toMatch(/periodic\.ts\s{2,}reconcile/)`.

---

### R-002 · Under print, the terminal pane keeps `bg-sunk` — the one case the Paper theme exists for

**Where:** `packages/ui/src/styles/terminal.css:23`
(`[data-theme="paper"] .qed-pane { background: var(--bg-raised) }`) against
`packages/tokens/build.ts:186` (`@media print { :root:not([data-theme="paper"]) { … } }`).

**Violates:** *"Paper exists for print, PDFs and the audit bundle."* and
*"its Paper counterpart is darkened to `#06824a` to clear 4.5:1 on white"*
(brand book §2), plus the repo's own D-005: *"On `bg-sunk` (`#f1efe8`) the same
green is **4.24:1**, so a printed `EQUIVALENT` fails the system's own contrast
note."*

**What happens.** The print rule swaps the *page* variables when the root is not
explicitly `data-theme="paper"`. The only component-level theme override in the
repo is selected on `[data-theme="paper"]`, which by construction does not match
in that case. So printing the console Run view, or the marketing home page, or
anything else with a terminal in it, puts `proof` `#06824a` on `bg-sunk`
`#f1efe8` — **4.24:1**, measured with the repo's own `contrastHex`. The
behaviour is also inconsistent: a reader who *has* toggled to Paper prints it
correctly; a reader who has not gets the failing version. That inconsistency is
precisely what F-007 claimed to remove.

G10 cannot see it: `tests/e2e/evidence.spec.ts:356` reads
`getComputedStyle(document.body).backgroundColor` only, on the attestations
route, which has no pane.

**Fix.** Make the override theme-agnostic, e.g. key it on the resolved ground
rather than the attribute — add to the `@media print` block in `build.ts`
(or terminal.css):

```css
@media print { .qed-pane { background: var(--bg-raised); } }
```

and extend G10's evidence to read `.qed-pane`'s computed background under print
media on `#/run`, not just `document.body` on `#/attestations`.

---

## SHOULD-FIX

### R-003 · The failed-verification state cannot be reached in the shipped product

**Where:** `apps/console/src/App.tsx:29-39`.

**Violates:** *"**Verify is a real action.** The button re-derives the verdict
from the record and shows the result. An attestation nobody can check
independently is decoration."* (`components/Attestation/README.md`).

`verify()` sets `checking`, waits 400 ms on a `setTimeout`, and then
unconditionally sets `{ status: "verified" }`. It re-derives nothing, and
`mismatch` / `error` are unreachable outside the gallery and a unit test.
D-027 and the F-003 row in FLAWS.md read as though the product gained a state;
it gained a stylesheet rule. The fixed 400 ms delay is also a simulated spinner
on a check that does no work, against *"Spinners that outlive the run, progress
bars with fake smoothness"* (`components/Terminal/README.md`).

**Fix.** Re-derive something real from the fixture — recompute the digest from
the record fields and compare — and seed one fixture that fails, so the console
can actually show `mismatch`. If that is out of scope, say so in D-027 rather
than describing an unreachable state as shipped behaviour.

---

### R-004 · G10's 9 px glyph numbers are a registration artifact, not a shape difference

**Where:** `tests/e2e/evidence.spec.ts:53-87` (`comparePairwise`),
`scripts/verify.ts:1027-1049`.

**Violates:** the property the gate claims — *"Colour never carries a verdict
alone. Glyph first, colour second."* (brand book, rule 2) — by measuring
something else.

**Measured, from the committed evidence.** The three `dot9-*.png` files are not
the same size (`EQUIVALENT` 36×40, the other two 40×40) and, worse, their ink is
offset: ink bounding boxes are `x 3..32` for `EQUIVALENT` and `x 7..36` for the
other two — a 4-device-pixel (1 CSS px) horizontal shift. `comparePairwise`
crops all bitmaps to the common box **from (0,0)**, which equalises dimensions
but does not align the shapes. The consequence is visible in the numbers:

| pair | at 96 px (aligned) | at 9 px (misregistered) |
| --- | --- | --- |
| EQUIVALENT vs ABSTAINED | 20.3 % | **57.4 %** |
| EQUIVALENT vs DIVERGED | 54.1 % | **56.4 %** |
| DIVERGED vs ABSTAINED | 41.1 % | 37.4 % |

The same two shapes cannot differ on 20 % of pixels at one size and 57 % at
another. The two inflated rows are exactly the two involving the offset bitmap;
the one correctly-registered pair (DIVERGED/ABSTAINED) is the only honest
number. The commit message's *"The real 9px numbers are 56%, 57% and 37%"* is
therefore wrong about two of three.

**Why it matters as a gate.** Two *identical* 7.5 px discs offset by 1 CSS px
would differ on roughly 17 % of the cropped box — comfortably over G10's 8 %
bar. The gate would pass a design in which colour is the only thing separating
two verdicts.

**Fix.** Align on ink centroids (or on each bitmap's ink bounding box) before
comparing, not on (0,0); and fail — not crop — when the three screenshots come
back at different sizes, since that is itself evidence the three glyphs are not
rendering identically.

---

### R-005 · The shipped lockup never uses the design system's own lockup geometry

**Where:** `packages/ui/src/components/Logo.tsx:163-181`; confirmed in
`apps/web/dist/index.html` (`data-lockup-mark="mark-16"` at every occurrence).

**Violates:** `assets/Logos/README.md`: *"`qed-logotype.svg` | The lockup:
wordmark plus mark. **Default for sites, decks, README headers.**"* The
published file carries the smoothed mark (r 5.5 %, cut 46 %).

`LOCKUP_MARK_RATIO` is 56.16/132 = 0.4255, so a lockup at `sm` (24 px) draws a
10.2 px mark and at `lg` (48 px) a 20.4 px mark — both ≤ 24, both resolved to
`mark-16`. Only `xl` (96 px → 40.8 px mark) would reproduce the published
drawing, and nothing in the repo uses `xl`. The result is that the product's
logo silhouette (square corners, 52 % cut) differs from the design system's
published logotype everywhere it appears. `logoArt.logotype`'s own shapes are
dead code, retained only so G4's "generated module contains every path" check
passes.

This is defensible by the letter of *"Use `qed-mark-16.svg` for … anything under
24px"*, but it is a visible identity change that no gate records and
`DECISIONS.md` D-024 states as settled (*"At `xl` the result is the shipped
file's own geometry"*) without noting that `xl` is unreachable.

**Fix.** Either size the lockup so its mark lands at ≥ 32 px (see R-006) and let
the smoothed mark do its job, or make the substitution explicit: raise it with
the design-system owner and add a gallery shot of the lockup at `xl` so the
"matches the published file" claim is actually under test.

---

### R-006 · `size` means the mark for one variant and the whole box for the others

**Where:** `packages/ui/src/components/Logo.tsx:49-50, 76-80`; `D-025`.

**Violates:** `assets/Logos/README.md`: *"`qed-mark.svg` | The mark at 32px and
above"* / *"`qed-mark-16.svg` | The mark at 24px and below"* — a rule stated in
mark pixels, now interpreted against two different units depending on variant.

Round 2 tightened the **mark** viewBox to `2 2 20 20` so `size="xs"` draws a
16 px mark (D-025), but left the lockup and wordmark measuring the 132-unit box.
So `size="sm"` means a 24 px mark in one call and a 10.2 px mark in another. The
header lockup (`apps/web/src/Layout.tsx:31`) therefore ships a 10 px mark and a
13 px x-height — well under the 16 px the system treats as the floor
(*"At 16px the smoothed corners close up and the cut stops reading"*).

**Fix.** Make `size` mean the same thing in all three variants — the x-height
for wordmark and lockup, as the system's own construction table is expressed —
and re-pick the header/hero steps so the lockup's mark lands at a size the
system names.

---

### R-007 · F-020 made the attestation's foot rule *less* visible in the primary theme

**Where:** `packages/ui/src/styles/attestation.css:8, 71`.

**Violates:** `tokens.json` — `rule`: *"Every border and divider in the product.
The system has one hairline."*; `rule-strong`: *"**Under a section heading, and
the left rule of an attestation.**"* The attestation's outer border and its foot
divider are neither. `components/Attestation/preview.html` sets
`border:1px solid var(--rule)` and `border-top:1px solid var(--rule)`.

F-020 claims the swap gives *"the most visible hairline available on that
ground"*. Measured on `proof-dim`, the ground the foot rule sits on:

| | Void | Paper |
| --- | --- | --- |
| `rule` on `proof-dim` | **2.87:1** | 1.03:1 |
| `rule-strong` on `proof-dim` | 2.07:1 | **1.40:1** |

In Void — the primary theme — the change took the foot rule from 2.87:1 to
2.07:1. The claim is true only in Paper. (The outer border is a genuine trade:
it is more visible against the outside `bg`, 1.76 vs 1.27.)

**Fix.** Return the foot rule to `rule` as the preview specifies, or state the
per-theme trade-off honestly in FLAWS.md/DECISIONS.md instead of a blanket "most
visible available".

---

### R-008 · G7 still asserts "at least one error of any kind"

**Where:** `scripts/type-tests.ts:88`, `scripts/verify.ts:850-857`.

F-023 says G7 *"compares `actualErrors` against `expectedErrors` instead of
recording it and ignoring it"*. `expectedErrors` is written as the literal `1`
for every invalid file, so the comparison reduces to `actualErrors >= 1`. The
error **code** is computed on line 89 and thrown away — never written to
`.verify/type-tests.json`, never asserted. `INFRASTRUCTURE_CODES` filters
TS6053/2307/5083/18003, but not TS2304 (undefined name), TS1005 (syntax) or
TS2339 — so a typo in an `.invalid.tsx` file makes it "pass" without the verdict
type doing any work. The property the gate claims ("evidence-free verdicts
cannot be constructed") is not what it measures.

**Fix.** Record the expected TS code and the expected substring per invalid
file (a `// @expect TS2345 inputs` pragma) and assert both.

---

### R-009 · G4 does not hash the wordmark's two stems, nor any transform or viewBox

**Where:** `scripts/verify.ts:538-540` (`pathDataOf` matches `\sd="…"` only),
`:596-621`.

`qed-wordmark.svg` is three `<path>` elements **and two `<rect>` stems** (the
`q` descender at `x=59.4,y=0,h=98` and the `d` ascender at `x=236.2,y=-26`).
Only the three `d` attributes reach `baseline.files[].paths`. The file-byte
sha256 protects the source asset, but the generated module check
(`text.includes(d)`) and the shipped-HTML check (`block.matchAll(/\sd="…"/g)`)
both iterate `entry.paths` — so editing `packages/ui/src/generated/logos.ts` to
move a stem, or a lockup emitted with a wrong `transform`/`viewBox`, passes G4
with "all verbatim". The composed lockup (R-005) is precisely a case where the
path data is verbatim and the *composition* is what changed, and G4 is blind to
it.

**Fix.** Include `rect` geometry and the `viewBox` in the baseline hash, and
assert the lockup's emitted `transform` against the LOCKUP constants.

---

### R-010 · G5 checks the cut but not the radius, the angle, or the lockup's mark

**Where:** `scripts/verify.ts:704-752`, `tests/e2e/evidence.spec.ts:211-268`.

G5 measures (a) the cut as a fraction of the bottom edge, (b) whether the
*single* top-left corner pixel is ink. It never measures the 5.5 % radius value,
never checks the other two intact corners, never measures the cut's 45° angle
(*"The `e` aperture is cut at **45°** — the same angle as the mark's corner"*),
and never checks the mark is square.

Realistic violation that still passes: a mark whose three corners are rounded at
**15 %** instead of 5.5 %. `cornerIsSquare` samples the exact bounding-box
corner, which is non-ink for any radius > 0, so it reports "smoothed" and the
gate is satisfied — while the mark reads as a rounded rectangle, which the
Logotype preview labels as misuse.

Also: the four `[data-mark]` holders are standalone marks only. The mark inside
the composed lockup — the one the round-2 change actually touched — is measured
by nothing.

**Fix.** Measure the corner by fitting the curve against the 5.5 % expectation
(sample the 45° diagonal inset), measure the cut's slope, and add `[data-mark]`
holders for the lockup's embedded mark at every lockup size including `xl`.

---

### R-011 · G6's 10 % threshold is non-binding; "theme parity" is only "the ground changed"

**Where:** `scripts/verify.ts:803-812`.

Every component reports 99.88–100 % of pixels differing between themes, because
the ground inverts underneath everything. A 10 % floor against a 99.9 % actual
is not a test. G6 cannot distinguish a correctly themed component from one with
a hard-coded Void ink colour that is invisible on Paper: the surrounding ground
still inverts, the shot still differs ~100 %, the gate still passes.

**Fix.** Compare per-component, not per-shot: assert that the set of distinct
colours in each shot is a subset of the resolved token values for that theme
(the data is already available via `rawColor`), and drop the pixel-ratio check
to a secondary note.

---

### R-012 · The attestation's stack breakpoint is a viewport query inside a fixed sidebar — **UNCONFIRMED**

**Where:** `packages/ui/src/styles/attestation.css:120`
(`@media (max-width: 560px)`), `apps/console/src/console.css:36-39`
(`grid-template-columns: 26ch 1fr`), `component-tokens.json` `bp-stack`:
*"Derived: the width at which the attestation's 132px label column stops fitting
beside its value."*

The console reserves ~216 px for the nav down to a 721 px viewport. At 721 px
the attestation's own box is ≈ 409 px, inner ≈ 361 px, leaving ≈ 205 px for a
`mono` value beside the 132 px label column — about 28 characters, so
`clock frozen · rng seed 0x5f3a · network denied · overlay fs` sets on three
lines. `bp-stack` fires on the **viewport**, which is 721 px, so the stack never
happens at the width the token's own comment is about.

**UNCONFIRMED:** derived from the CSS, not rendered. Settle it by screenshotting
`#/attestations` at viewport widths 721 / 800 / 900.

**Fix.** Make it a container query (`@container (max-width: 560px)`) on the
attestation, or move the breakpoint to account for the sidebar.

---

### R-013 · The FocusRing composite shows two concentric focus rings

**Where:** `packages/ui/src/styles/controls.css:84-87` (`.qed-focus-ring:focus-within`)
against `packages/ui/src/styles/base.css:54-58` (`:focus-visible`).
**Screenshot:** `FocusRing-void-chromium-win32.png`.

**Violates:** *"`focus` is the one colour that is neither brand nor verdict: **a
2px ring at 2px offset**"* (brand book, rule 5).

The baseline shows a tight ring around the link *and* a full-width ring around
the composite, simultaneously. The FocusRing component exists so the ring is
visible when a bare control sits inside a row, but the inner control also gets
the global ring. Round 2's F-025 put the real treatment into the baseline and
then accepted the doubled result.

**Fix.** Suppress the inner ring inside a focus-ring composite:
`.qed-focus-ring :focus-visible { outline: none }`.

---

### R-014 · The verdict dot renders 7.5 px, not the 9 px the system specifies

**Where:** `packages/ui/src/components/verdict.tsx:24, 62`
(`DISC = "M6 1A5 5 … "` in `viewBox="0 0 12 12"`),
`packages/ui/src/styles/verdict.css:7-11` (`width: var(--c-dot-size)` = 9 px).

**Violates:** `components/Verdict/README.md`: *"Glyph **9px** at `radius-round`
— the only round shape in the system."* It is also carried as a token
(`component-tokens.json` `dot-size: 9px`, cited to that sentence).

The disc is radius 5 centred at (6,6), so its ink spans 10 of 12 user units:
9 px × 10/12 = **7.5 px**. Measured in `.verify/shots/dot9-*.png` at
`deviceScaleFactor: 4`: every glyph's ink bounding box is exactly 30×30 device
px = 7.5 CSS px.

This is the identical defect that round 2 fixed for the mark (*"`size` means the
mark, not the box"*, D-025 / F-009) and did not apply here.

**Fix.** Tighten the glyph viewBox to `1 1 10 10`, or set
`--c-dot-size: calc(9px * 12 / 10)`. Add the measured ink diameter to the G10
evidence so it is pinned.

---

### R-015 · The console header sets the wordmark in a font

**Where:** `apps/console/src/App.tsx:49-53` —
`<Logo variant="mark" size="sm" /> <span className="t-heading">QED</span>`.

**Violates:** `components/Logotype/README.md` **Never** list: *"**Re-set the
wordmark in a font.**"*; `assets/Logos/README.md`: *"Never … re-set the wordmark
in a font."*; brand book §1: *"**The wordmark is drawn, not set.**"*; and the
lockup rule *"Lowercase always. `QED` in capitals appears only at the start of a
sentence in prose."*

The console's primary brand position — top-left, mark followed by the word,
before the repository name — renders the mark as SVG and the word as Instrument
Sans 15/600 capitals. That is a lockup assembled from the mark plus a typed
wordmark, which is the one thing the system names twice as forbidden. The
`lockup` variant exists and is used on the marketing site; the console does not
use it. Neither previous round flagged it.

**Fix.** `<Logo variant="lockup" size="sm" decorative />`, with the repository
name as the only text beside it. If the capitals are wanted as a product label
rather than a logo, separate them visually from the mark so the pair does not
read as a lockup.

---

### R-016 · `AttestationsView`'s comment contradicts the fix F-004 made

**Where:** `apps/console/src/views/AttestationsView.tsx:13-14`:
*"The timestamp is part of the record rather than read from a clock, so a re-run
of the screenshot produces the same pixels."*

F-004/D-028 changed exactly this: `App.tsx` now reports `new Date()`. The
comment now documents the behaviour that was removed, in the file a reader opens
first. A fix that leaves its own rationale contradicted in the source is worse
than no comment.

**Fix.** Replace with the D-028 reasoning.

---

### R-017 · Docs code blocks scroll but cannot be scrolled by keyboard

**Where:** `apps/web/src/Docs.tsx:38` (`<pre className="web-docs-code">`),
`apps/web/src/web.css:212-219` (`overflow-x: auto`, no `tabindex`).

Every other scroll container in the repo carries `tabIndex={0}` + `role="group"`
+ `aria-label` (`.qed-pane-scroll`, `.qed-table-scroll`). The docs `<pre>` does
not. On a narrow viewport `curl -fsSL https://qed.dev/install.sh | sh` overflows
and a keyboard-only reader cannot reach the end of it (WCAG 2.1.1). axe-core
does not detect this, which is why G8 is green.

**Fix.** Give the `<pre>` `tabIndex={0}` and an accessible name, as the other
two scroll regions already have.

---

## TASTE

### R-018 · `--c-pane-max: 776px` is 2 px short of the 80 columns it is derived from

`component-tokens.json` derives 776 px as 728 px of content + `space-6` either
side. `base.css` sets `box-sizing: border-box` globally and `.qed-pane` adds a
1 px border, so the content box is 776 − 48 − 2 = **726 px**. The exactly-80-column
row (`  ○ ABSTAINED   api/handlers.go      CreateOrder     opens a database connection`)
is therefore ~2 px wider than the pane and triggers a horizontal scrollbar on
the hero. Fix: 778 px, or `max-width: calc(…)` that accounts for the border.

### R-019 · D-013's reasoning overrides an explicit component instruction

`components/Verdict/README.md`: *"Chip: … 8px padding-left, **10px right**."*
The repo ships 8/12 (`verdict.css:29`) because *"10px is not on the 4px grid"*.
The grid sentence is about the token scales; the component README gives a
specific optical instruction for this one element, and the system's own preview
sets `padding:5px 10px 5px 8px` — vertical 5 px, which is also off-grid, showing
the system treats chip padding as optical rather than gridded. "Where the code
and the system disagree, the system wins" (DECISIONS.md's own opening) argues
for 10 px. Fix: add a `chip-pad-right: 10px` component token with the sentence
it comes from, as D-012 already does for the 9 px dot.

### R-020 · D-029's defence of `ch` is self-serving

G2 allows `em` and `ch` because they *"carry no independent design value"*.
`26ch` for the console sidebar (`console.css:37`), `24ch` for the docs nav,
`52ch` for the table floor, `66ch`/`28ch`/`30ch`/`18ch`/`54ch`/`72ch` elsewhere
are all numbers someone chose. They are design values in a unit G2 does not
scan. Fix: declare them as `--c-*` tokens like every other measure, or drop the
claim from D-029 and say the exemption is pragmatic.

### R-021 · `DECISIONS.md` D-016 is stale

D-016 still says *"The terminal pane measure is 760px"*; the shipped token is
776 px and D-026 says so. Two decisions in the same file give different numbers.

### R-022 · The favicon ships a Void-only ink

`apps/{web,console}/public/favicon.svg` is `qed-mark-16.svg` byte-for-byte, with
`fill="#12e27e"` baked in. `assets/Logos/README.md`: *"On Paper, wordmark
`#0b0b0b` and mark `#06824a`."* On a light browser tab `#12e27e` is 1.9:1
against white. Fix: add an inline `<style>` with
`@media (prefers-color-scheme: light)` inside the favicon, and exempt it from
G4's byte hash (or hash both variants).

### R-023 · The empty run prints two consecutive blank lines

`TerminalOutput` with no runs emits `push()` after the header and `push()`
before the summary with nothing between, so the pane shows a double gap
(`TerminalOutputEmpty-*.png`). An empty state nobody tightened. Fix: skip the
leading blank when `result.runs.length === 0`.

### R-024 · The theme toggle's label is wrong until the end-of-body script runs

`apps/web/src/Layout.tsx:57` hard-codes
`aria-label="Switch to Paper theme (currently Void)"` and the text "Paper".
`THEME_BOOTSTRAP` runs in `<head>` and may paint the page in Paper;
`TOGGLE_SCRIPT` runs before `</body>` and only then corrects the label. For a
returning Paper reader the header paints with a button that says "switch to the
theme you are already in". Fix: have the head bootstrap set the button's text
and label too, or render the button from a `data-` attribute the bootstrap owns.

### R-025 · `.qed-section` uses `space-16` between sections

`tokens.json` — `space-8`: *"Between sections."*; `space-16`: *"Above a display
line."* `layout.css:29-32` uses `space-16` for section padding top and bottom.
Reads fine; it is not the token the system names for the job.

---

## Gate blind spots — one realistic violation each that still passes

| Gate | A realistic violation it would not catch |
| --- | --- |
| **G1** contrast | Any **state** colour. The sweep (`sweep.ts`) reads the resting computed style only — no `:hover`, `:focus`, `:active`, `::placeholder`, `::selection` — and runs under `media: screen` only, so the print theme's contrast (R-002, 4.24:1) is never measured. It also skips every `:disabled` subtree wholesale, so `proof-press` used as text inside a disabled control would evade the one token-level ban it checks. |
| **G2** token purity | `LENGTH_RE` covers `px\|rem\|pt` only. `padding: 1.5em`, `width: 42ch`, `gap: 3%`, `height: 40vh`, `line-height: 1.4`, and `style={{ marginTop: 10 }}` in a `.tsx` (a unitless number React turns into px) all pass. `opacity`, `mix-blend-mode` and `mask` are not in `FORBIDDEN_EFFECTS`. |
| **G3** 4 px grid | It inspects `--space*/--radius*/--type-*-line` definitions and a 19-property allowlist. `width`, `height`, `inset`, `top/left`, `border-width`, `font-size`, `letter-spacing`, `grid-template-columns` and `flex-basis` are unchecked — `width: 30px` on a card passes. It reads built CSS only, so an inline `style` attribute is invisible to it. |
| **G4** logo fidelity | Move a wordmark stem: edit `{ kind: "rect", x: 59.4 … }` to `x: 80` in `generated/logos.ts`. No hash covers rect geometry, and the shipped-HTML scan only reads `d="…"`. Also: wrong `transform` or `viewBox` on the composed lockup, and anything rendered client-side by the console (its `dist/index.html` has an empty `#root`, so zero `.qed-logo` blocks are inspected there). |
| **G5** mark optics | A mark with 15 % corner radius instead of 5.5 %. `cornerIsSquare` samples the bounding-box corner pixel, which is non-ink at any radius > 0, so it reports "smoothed" and passes. The cut's 45° angle and the mark inside the lockup are not measured at all. |
| **G6** theme parity | A hard-coded `#f6f5f1` text colour, invisible on Paper. The shot still differs ~100 % from Void because the ground inverted, so the 10 % floor is never approached. Observed values: 99.88–100 % on all 20 components. |
| **G7** verdict integrity | An `.invalid.tsx` that fails to compile for an unrelated reason — a misspelled import binding (TS2305) or a stray character (TS1005). `expectedErrors` is the constant `1`, infrastructure filtering covers only four codes, and the error code is computed then discarded. |
| **G8** a11y | Everything axe cannot see: focus order, keyboard traps, a scrollable region with no `tabindex` (R-017 is live in the repo today and G8 is green), whether a `role="status"` is announced usefully, and reflow — the sweep runs at 1280×900 in both themes and never at 320 px or 200 % zoom. |
| **G9** bundle budget | Non-JS weight. CSS, the four woff2 files and any image are outside the budget; a 500 KB stylesheet passes. A `<script src="https://cdn…">` is counted at 0 bytes because `walkIncludingDist` only gzips local `.js` files, and an inline event-handler attribute (`onclick="…"`) is not inside a `<script>` tag so it is not counted either. |
| **G10** print | Any component-level print regression. It reads `document.body`'s background, the five `dt` labels and a button count, on `#/attestations` only. R-002 — the terminal pane printing on the wrong ground, in the theme that exists for printing — passes it. Plus the 9 px glyph comparison it rests on is misregistered (R-004). |

No gate has *no* hole.

---

## Summary

| Severity | Count |
| --- | --- |
| blocking | 2 |
| should-fix | 15 |
| taste | 8 |
| **total** | **25** |

One item (R-012) is marked **UNCONFIRMED**.

---

# Resolution — round 3

Three rounds is the limit, so this is the last pass. Both blocking items and
every should-fix item are fixed; the taste items are fixed or recorded as
decisions. `pnpm verify` is green on all ten gates, and four of them now fail on
things they previously could not see.

The review's central charge is fair and worth stating plainly: round 2 replaced
weak checks with different weak checks, and a gate that passes for the wrong
reason is worse than no gate. Each fix below is demonstrated rather than
asserted.

## Blocking

**R-001 · Fused columns.** Confirmed exactly as reported — the home page shipped
`periodic.tsreconcileOutstandingSettlementBatches`. `pad` was `padEnd`, which
never truncates, so a value longer than its column came back with no gap at all.
`pad` now guarantees two spaces. The fixture test that missed it is replaced by
a property test over arbitrary path and symbol lengths at 40–160 columns; it
fails on the old `pad` and passes on the new one, which was checked both ways.

**R-002 · The printed pane.** Confirmed. The page variables switched to Paper
under `@media print`, but the pane's own override was keyed on
`[data-theme="paper"]`, which by construction cannot match an unmarked
document — so the printed pane kept `bg-sunk` and `proof` landed at 4.24:1.
There is now a `@media print` rule on the pane itself. G10 reads the printed
page back and asserts the ground, the five field rows and that no control
survives.

## Should-fix

**R-003** `verifyRecord` recomputes a SHA-256 over the record's signed fields and
compares it with the digest the record carries. Four unit tests cover match,
mismatch, a field tampered after signing, and that the time reported is the
check's rather than the record's. One console fixture carries a deliberately
wrong digest, so the failed state is reachable in the product.
**R-004** Glyphs are registered on their ink before comparison, so the numbers
measure shape rather than where in its box each one landed. At 9px the three
now differ by 81%, 77% and 63%.
**R-005, R-006, R-034** `size` means the drawing for the mark and the box for
the lockup; recorded as D-034. The mark inside a lockup is the system's own
0.42× proportion, and the variant is derived from the drawn size.
**R-007** Reversed: `rule` in Void (3.69:1) and `ink-faint` in Paper (2.17:1),
each the most visible hairline that theme has. Round 2's swap did make Void
worse. D-030.
**R-008** Each negative type test declares `// @qed-expect-error <n>`, and the
gate compares against it.
**R-009** The baseline covers the viewBox and every rect as well as every path,
through one shared implementation — the two copies had the same broken regex and
agreed with each other while reading nothing. G4 now fails when a rect moves by
one unit, demonstrated by moving one.
**R-010** G5 measures the corner radius: 4.69% for the smoothed mark against its
stated 5.5%, 0% for the square one. The 45° cut angle is still unchecked.
**R-011** G6 also asserts Void is the darker theme, so a palette that merely
differed no longer passes.
**R-012** The attestation's field column is a container query on the card, not a
viewport query — the console's sidebar sets the card's width, which a viewport
query cannot see.
**R-013** One ring: the composite suppresses the inner control's while it holds
focus.
**R-014** The dot's viewBox is tightened to its ink, so 9px of token renders 9px
of glyph.
**R-015** The console header uses the drawn lockup instead of `QED` set in
Instrument Sans.
**R-016** The stale comment is gone.
**R-017** The docs' command blocks are focusable and labelled.

## Taste

**R-018** `--c-pane-max` is 780px: 728px of columns, plus padding *and* the
hairline either side.
**R-019, R-020** Recorded as D-013 and D-029; the reasoning stands, and both are
stated as choices rather than as the system's instruction.
**R-021** D-016 is marked superseded by D-026.
**R-022** The favicon ships the Void ink. A single SVG icon cannot follow a
theme the page has not loaded; the mark is `proof` in both themes and the Paper
ink differs only in lightness.
**R-023** Consecutive blank lines are collapsed, so an empty run reads as empty
rather than as a gap.
**R-024** The toggle script is attached immediately after the header rather than
at the end of the body. Moving it exposed that it had never been attached at all
in the built output — the replacement ran against the template, before the body
existed. The build now throws if the header is missing, and a flow test drives
the toggle on both marketing pages.
**R-025** `.qed-section` uses `space-8`, the token whose usage note is "Between
sections".

## Still open

- The 45° cut angle is measured by no gate (R-010, in part).
- A mark rendered mirrored or rotated passes G4; only the lockup is checked
  against a reference, and only at one size.
- `:active` and `:focus` colour pairs are swept by nothing.

These are recorded in the README's "What the gates do not catch", with the rest.
