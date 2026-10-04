# Decisions

Every judgement call made while building the product surfaces from the QED
design system, and every place the system contradicts itself or its own rules.

The system is the spec. Where code and the system disagree, the system wins —
so each entry below says what the system asks for, why that could not be
followed literally, and which of the system's own rules decided it.

Source: <https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B>, version
`1791100908-8a30`. The files it was read from are copied verbatim into
[design-system/reference/](design-system/reference/).

---

## Contradictions inside the design system

These are not preferences. In each case two parts of the system ask for
different things, and one had to be chosen.

### D-001 · The CLI banner says `QED`, not `WARRANT`

`components/Terminal/README.md` says the banner carries
`WARRANT · DETERMINISTIC VERIFICATION`. Its own `preview.html` renders
`QED · DETERMINISTIC VERIFICATION`, and the brand book is titled QED
throughout.

**Chosen:** `QED`. The README sentence looks like residue from a rename — the
word appears nowhere else in the system.

### D-002 · Inside the attestation, every line is `ink`

`components/Attestation/preview.html` sets the subject line, the field keys and
the digest in `ink-muted`, and the eyebrow in `proof`, on the `proof-dim`
ground. In Void those are **1.67:1** and **3.14:1**. Neither can carry a
sentence.

The same README already forbids `proof` for the verdict inside the card, and
`break` on `proof-dim` is 1.21:1 in Void and 4.42:1 in Paper — so no verdict
colour works there either.

**Chosen:** everything inside the card renders in `ink` (4.9:1 in Void, 18:1 in
Paper), including the verdict word and its glyph. Hierarchy comes from the type
styles, which is what the brand book asks for anyway — *"Hierarchy comes from
weight and size, never from a second personality."* The state is carried by the
glyph, which is the system's first rule: *"Colour never carries a verdict
alone. Glyph first, colour second."*

The eyebrow mark stays `proof` — 3.14:1, which clears the 3:1 bar for a
graphic.

### D-003 · `proof-dim` is not used for button hover or press

`tokens.json` gives `proof-dim` the usage *"Hover and pressed states, and the
tint behind a signed attestation."* As a button fill it puts the label at
**3.38:1** in Void and **1.29:1** in Paper.

**Chosen:** `proof-dim` is used only as the attestation ground. Hover and press
go to `proof-press` (7.48:1 and 6.63:1). The pressed state adds an inset rim in
the ground colour rather than a shadow, because the system has no shadows.

### D-004 · The hairline is exempt from the 3:1 non-text bar

`rule` is 1.24:1 against `bg` in Void and `rule-strong` is 1.76:1. No border
token in Void reaches 3:1 — the low-contrast chrome is a stated brand position
(*"Rules and space do the work"*).

WCAG 1.4.11 applies to non-text content **required to identify a control or its
state**. No control in this repo depends on a hairline to be found: every one
carries a label at 4.5:1 and a focus ring at 3:1 or better. The two tokens are
listed as a reasoned exemption in `scripts/verify.ts` rather than skipped
quietly, and axe-core agrees on all sixteen route/theme combinations.

### D-005 · On Paper, the terminal pane sits on `bg-raised`

`components/Terminal/README.md` puts the pane on `bg-sunk`. The brand book says
`proof` was darkened to `#06824a` on Paper *"to clear 4.5:1 on white"* — and it
does, at 4.64:1 on `bg`. On `bg-sunk` (`#f1efe8`) the same green is **4.24:1**,
so a printed `EQUIVALENT` fails the system's own contrast note.

**Chosen:** Void keeps true black, where *"the output is the hero"*. Paper puts
the pane on `bg-raised`, where `proof` is 4.89:1. Gate G1 scopes the
`proof`/`bg-sunk` pair to Void and says why.

### D-006 · The font files are vendored from Google Fonts

`tokens.json` carries `"type": {"fonts": []}` — the system names Instrument Sans
and Martian Mono but ships no files, and its previews load them from the Google
CDN.

**Chosen:** the latin and latin-ext woff2 subsets are vendored into
[packages/ui/src/assets/fonts/](packages/ui/src/assets/fonts/) and self-hosted,
because the brief requires it. Both are variable faces, so one file covers every
weight. Neither family ships `U+25CF`, `U+25CB` or `U+220E`, so the verdict
glyphs and the tombstone come from a fallback face; the terminal pane gives each
glyph a fixed `1ch` box so the columns still line up.

### D-007 · The `DIVERGED` glyph is an upright cross, cut to the rim

`components/Verdict/README.md` asks for a *"cross-filled circle"* at 9px. Two
things had to be decided:

- **Upright, not a saltire.** At 9px a 45° knockout lands between pixels and
  silts into a grey ring.
- **Cutting all the way to the rim.** A cross that stops short leaves the
  circumference unbroken, so the glyph reads as the hollow `ABSTAINED` ring with
  something inside it — the one confusion this glyph exists to prevent. The arm
  corners sit exactly on the circle, so nothing spills outside it.

Measured, in greyscale at the shipped 9px: `DIVERGED` and `ABSTAINED` now differ
on 34% of pixels. Gate G10 asserts that, at the large size *and* at 9px.

### D-008 · `mono` is 13/20, not 13/21

`components/Terminal/README.md` says *"Martian Mono 13/21"*. `tokens.json` says
`lineHeight: 20px`, and the brand book says every line height is a multiple of
four. 21 is not.

**Chosen:** `tokens.json`. Gate G3 would fail on 21 anyway.

### D-009 · The summary line prints all three counts

`components/Terminal/README.md`: *"The summary line states all three counts,
always, including zeros."* Its preview prints only two —
`1 divergence · 2 abstained · exit 1`.

**Chosen:** the rule. The output reads
`3 equivalent · 1 divergence · 2 abstained · exit 1`. The README is explicit
about why: hiding a count is what would make the output less believable.

### D-010 · The small mark covers 24px, not 23px

The brief says *"use qed-mark-16 below 24px"*. Both
`assets/Logos/README.md` and `components/Logotype/README.md` say the small file
covers *"24px and below"* and the smoothed one *"32px and up"*, and the brief's
own gate G5 asserts *"the 16/24 renders use the small variant"*.

**Chosen:** the system and G5 — small at 24px and below. The 25–31px range is
undefined by the system; it resolves to the smoothed mark, and no size in that
range is reachable through the API.

---

## Where the system is silent

### D-011 · Logo sizes are named steps

The brief requires that *"size is a prop, the variant is derived, and the caller
cannot pick the wrong one."* `size` takes `xs | sm | md | lg | xl`
(16/24/32/48/96px), the mark file is derived from it, and there is no prop that
names a file. Both are type-tested: `packages/ui/type-tests/` contains files
that must fail to compile, and G7 asserts they do.

### D-012 · Values stated only in a component README became tokens

The system states some sizes in prose but does not carry them in `tokens.json`:
the 9px verdict dot, the 132px attestation label column, the mark at 16px. A
component may not hand-write a size, so these live in
`packages/tokens/src/component-tokens.json` as `--c-*`, each citing the sentence
it comes from.

### D-013 · Chip padding is 8/12, not 8/10

`components/Verdict/README.md` asks for 8px left and 10px right. There is no
10px on the spacing scale and 10 is not a multiple of four. Used `space-2` and
`space-3`.

### D-014 · The evidence numeral is 32/36

The Verdict preview sets the table numeral at 28/32; `tokens.json` defines
`numeral` as 32/36 and describes it as *"The input count — the number read
before any word."* Used the token.

### D-015 · The banner mark is 16px, not 14px

`components/Terminal/README.md` puts the banner mark at 14px, which is off the
4px grid and not a declared size. Used 16px, the `xs` step, which is also the
size the attestation eyebrow uses.

### D-016 · The terminal pane measure is 760px

`components/Terminal/preview.html` sets `max-width: 690px`, which fits its own
sample run. A one-clause abstain reason on a realistic path overflows it, and
the README is explicit that *"a verdict list that wraps is a verdict list nobody
reads."* Widened to the next 4px step that fits the output; the pane still
scrolls horizontally rather than wrapping, and the scroll region is focusable.

---

## Engineering decisions

### D-017 · The marketing site ships no framework

React runs at build time only: `apps/web/prerender.ts` renders both pages to
static HTML and deletes the client chunk Vite emits. What ships is HTML, one
stylesheet, four woff2 files and ~880 bytes of inline script for the theme —
against a 40KB budget. A React runtime alone would have been roughly 45KB
gzipped, so the budget in the brief is only reachable this way, and it is the
right answer for a static page regardless.

`apps/console` is a real SPA and carries React; no budget was set for it.

### D-018 · The domain model lives in `@qed/ui/model`

`@qed/cli-render` must be pure and must not pull in a UI framework, but both it
and the terminal pane need the same verdict types and the same line layout — if
they diverged, the screenshot in a README and the text in a CI log would stop
agreeing. The React-free half of `@qed/ui` is exported as `@qed/ui/model`, and
`cli-render` imports from it (values for the line model, types for the rest).
This keeps the package list exactly as the brief specifies.

### D-019 · Paper is opt-in, and it is what prints

The brand book says Void is the primary theme and Paper *"exists for print, PDFs
and the audit bundle"*. So `:root` carries Void, `[data-theme="paper"]` opts in,
and `@media print` switches an unthemed document to Paper. There is no
`prefers-color-scheme` switch: an OS light preference is not a request for the
audit-bundle theme. The toggle is honoured and stored; the bootstrap that reads
it runs in `<head>`, so there is no flash, and the default needs no JavaScript
at all.

### D-020 · Breakpoints are the one px literal a stylesheet may hold

A media query cannot read a custom property. Breakpoints are still declared, as
`bp-*` component tokens, and gate G2 asserts that every px in a media prelude is
one of the declared values.

### D-021 · G1 asserts `proof-press` is never text, not `open`

The brief says *"The system states `open` is a mark colour — assert it is never
used as text."* The system says the opposite: `open` **is** the `ABSTAINED`
verdict colour and the Verdict preview sets the word in it. The token whose
usage says *"Never used as a text colour"* is `proof-press`.

**Chosen:** the gate asserts `proof-press` is never a text colour, and checks
`open` for contrast like any other text colour (it passes: 7.3:1 in Void, 5.0:1
in Paper). Flagging this rather than implementing it silently.

### D-022 · The verification status line stays in the accessibility tree

It was hidden with `display: none` while empty, which takes a live region out of
the tree — so the result of pressing *Verify independently* would never be
announced. It now collapses its margin instead and stays in the document. Found
by the keyboard flow test.

### D-023 · The logo is recoloured by token, never redrawn

The SVG files are drawn for Void with a literal fill, and `assets/Logos/README.md`
says the Paper inks are different. `scripts/generate-logos.ts` reads the four
files and emits a typed module in which every `d` and every rect is copied from
the file and the literal fill is mapped to the token that holds exactly that
value. Nothing is retyped, so nothing can drift; gate G4 hashes the files, the
generated module and the shipped output against a baseline taken from the
artifact.

---

## Open question for the design system

The brand book notes that `qed.dev` and the three-letter handles need checking,
and that QED Investors exists in a different trademark class. Nothing in this
repo depends on the word: the tombstone, the one green and the single typeface
are the brand, and a rename would touch copy and the `logoArt` keys only.

---

## Added in round 2, after review

### D-024 · The lockup is composed, not shipped from the file

`qed-logotype.svg` bakes in the smoothed mark, and the mark inside a lockup is
0.42× the lockup's height — so shipping that file draws the smoothed geometry at
10px in a 24px header, which the Logotype README's "Never" list forbids. The
lockup is composed from the wordmark plus whichever mark the drawn size calls
for, placed by the README's own rule: 0.78× the x-height, gap 30 units,
bottom-aligned to the baseline. At `xl` the result is the shipped file's own
geometry; below that it is the small mark, which is the point.

### D-025 · `size` means the mark, not the box around it

Both mark files are drawn inside a 24-unit box with the shape inset by 2 units.
Rendering the file at a given height therefore drew a mark 5/6 of that size, and
"use the small file at 24px and below" became ambiguous about which 24px. The
mark variant's viewBox is tightened to the shape's own bounds, so `size` is the
mark. Clear space is the layout's job, which is what the system means by it.

### D-026 · The terminal is 80 columns, and the pane is sized to that

Column widths were capped at numbers picked by eye, which still pushed the
evidence column off the pane for a long symbol. They are now derived: a terminal
is 80 columns unless told otherwise, so `buildRunLines` takes `columns` (default
80), shrinks the symbol column first and then the path column to fit, and gives
any row that outgrows its column its own evidence line. `--c-pane-max` is the
measured width of 80 columns of Martian Mono at 13px (728px) plus padding.

A row with both a 33-character path and a 37-character symbol still runs past 80
columns. Truncating either would hide which function the verdict is about, so
the row keeps its names and the pane scrolls — as a terminal does.

### D-027 · A record that did not re-derive loses its seal

`proof-dim` and the 2px `proof` rule are the system's mark of a signed record.
A failed verification keeps neither: the ground drops to `bg-raised` and the
left rule turns `break`. The README does not describe this state; leaving it
looking signed would have been the one reading the component must never allow.

### D-028 · Verification reports when it ran, not when the record was signed

The console's Verify action reports the time the check ran. An earlier version
reused the record's own timestamp so screenshots would be deterministic, which
made the product state something false to keep a test simple.

### D-029 · `em` and `ch` are allowed outside the token package

G2 rejects `px`, `rem` and `pt`. `em` and `ch` are relative to the type that is
already set from a token, so they carry no independent design value — a measure
of `66ch` is "however wide 66 characters of this font are", not a size someone
chose. They stay allowed, and this is the reason.
