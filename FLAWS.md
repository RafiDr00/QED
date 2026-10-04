# FLAWS

Review of this repository against the QED design system
([https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B](https://claude.ai/artifact/Rc4MG2zsgmczgdkQxHJB4B), version `1791100908-8a30`),
read directly from the artifact. Where code and the system disagree, the system
wins. `DECISIONS.md` was read last and several of its entries are challenged below.

Counts: **7 blocking · 20 should-fix · 6 taste**.

Measurements marked "measured" were taken from the committed PNGs in
`tests/e2e/visual.spec.ts-snapshots/` and `.verify/shots/` by decoding them with
the repo's own `scripts/png.ts`. Anything I could not confirm is marked
**UNCONFIRMED** with the check that would settle it.

---

## Blocking

### F-001 · Neither app ships a favicon, so the 16px mark is absent from the one surface the system names first

**File:** `apps/web/index.html:3-12`, `apps/console/index.html:3-18`,
`apps/web/prerender.ts:97-104`; built output `apps/web/dist/index.html:3-14` and
`apps/console/dist/` (no icon file, no `<link rel="icon">` anywhere in the repo —
`grep -rn 'favicon\|rel="icon"' apps` returns nothing).

**Violates:** `project/assets/Logos/README.md` — *"Use `qed-mark-16.svg` for
favicons, terminal banners and anything under 24px; `qed-mark.svg` everywhere
else. Shipping one file for both is the mistake this pair exists to prevent."*
The system ships a second mark file whose first stated use is the favicon, and
the repo uses it in exactly one place (the terminal banner). A browser tab —
the smallest, most-seen instance of the identity — carries the generic document
icon and `/favicon.ico` 404s.

**Severity:** blocking

**Fix:** copy `qed-mark-16.svg` to `apps/web/public/favicon.svg` and
`apps/console/public/favicon.svg`, recolour its literal `#12e27e` fill to
`currentColor` or keep the Void ink, and add to both `index.html` heads:
`<link rel="icon" href="/favicon.svg" type="image/svg+xml" />` plus a 32px PNG
fallback for browsers without SVG icons. Add the icon path to G4's shipped-output
scan so it is covered by the logo-fidelity gate.

---

### F-002 · Every lockup in the product draws the *smoothed* mark below 24px — the one thing the Logotype README says never to do

**File:** `packages/ui/src/components/Logo.tsx:38-52` (`artFor`: only
`case "mark"` calls `markArtFor`; `case "lockup"` always returns
`logoArt.logotype`), used at `apps/web/src/Layout.tsx:31`
(`<Logo variant="lockup" size="sm" />`) and `apps/web/src/Home.tsx:25`
(`size="lg"`).

**Measured:** in `tests/e2e/visual.spec.ts-snapshots/Logo-void-chromium-win32.png`
the lockup at `size="lg"` (48px) renders its green mark at a **20 × 20 px**
bounding box (`#12e27e` bbox x 129–148, y 42–61). Arithmetic: the logotype
viewBox is 132 units tall and the mark inside it spans y 16→72 = 56 units, so the
mark is always `56/132 = 0.424 ×` the declared size. Header (`sm`, 24px) →
**10.2px**. Hero (`lg`, 48px) → **20.4px**. Only `xl` (96px → 40.7px) clears 24px.
Every one of those draws the `qed-mark` geometry — 5.5% smoothed corners, 46% cut
— because that geometry is baked into `qed-logotype.svg`
(`packages/ui/src/generated/logos.ts:34`).

**Violates:** `project/components/Logotype/README.md`, "Never" list — *"Use the
large mark below 24px."* And `project/assets/Logos/README.md` — *"At 16px the
smoothed corners close up and the cut stops reading, so the small file squares the
corners and bites deeper."* The comment in `Logo.tsx:10-13` claims *"the wrong one
is unreachable from the API"*; it is reachable through the default variant.

**Why no gate catches it:** G5 only measures elements carrying `[data-mark]`,
which the gallery sets on `variant="mark"` only
(`tests/gallery/main.tsx:144-159`). G4 only checks that path strings are verbatim,
not the size they are drawn at.

**Severity:** blocking

**Fix:** build the lockup compositionally — render the wordmark art plus
`artFor("mark", markPxForLockup(sizePx))` positioned per the README lockup rule
(bottom-aligned to the baseline, 0.78 × x-height, gap 30 units) — so the optical
variant is derived for the lockup too. Then extend the gallery to carry
`[data-mark]` on the mark *inside* each lockup and make G5 assert the variant there
as well.

---

### F-003 · A failed verification looks exactly like a successful one

**File:** `packages/ui/src/components/Attestation.tsx:59-73` (`VerificationStatus`
renders `mismatch`, `error`, `verified` and `checking` into the same
`<p className="qed-verify-status t-body-sm" data-status=…>`),
`packages/ui/src/styles/attestation.css:86-97` — `data-status` is written and
**never styled**: there is no `[data-status]` selector anywhere in
`packages/ui/src/styles/`.

**Rendered evidence:**
`tests/e2e/visual.spec.ts-snapshots/AttestationMismatch-void-chromium-win32.png`.
The sentence *"Re-derivation produced a different digest. Do not rely on this
record."* renders in plain `ink`, body-sm, no glyph, no rule, no colour — on a
card whose ground is the brand's `proof-dim` green, whose eyebrow still reads
`SIGNED ATTESTATION`, whose verdict row still reads `● EQUIVALENT 18,402 inputs`,
and whose primary `proof` button is still the brightest object on the page. It is
the least prominent element in the card.

**Violates:** `project/README.md`, load-bearing rule 2 — *"**Colour never carries
a verdict alone.** Glyph first, colour second."* Here the failure state owns
*neither* a glyph nor a colour. And `project/components/Attestation/README.md` —
*"**Verify is a real action.** The button re-derives the verdict from the record
and shows the result. An attestation nobody can check independently is
decoration."* The result is emitted but not legible as a result. Also
`project/README.md` rule 1 — *"No claim without its evidence"* — the card goes on
asserting EQUIVALENT while the check says the digest does not match.

**Severity:** blocking

**Fix:** key the card off the verification state. On `mismatch`/`error`: drop the
`proof-dim` ground and the `proof` left rule to `bg-raised` + `break` rule, change
the eyebrow to `UNVERIFIED RECORD`, put the DIVERGED cross glyph beside the status
line, and switch `role="status"` to `role="alert"` so it is announced
assertively. Add `AttestationMismatch`/`AttestationError` assertions to
`tests/e2e/flows.spec.ts` that the ground and the eyebrow actually change.

---

### F-004 · "Verify independently" reports the record's signing time as the time it was verified

**File:** `apps/console/src/views/AttestationsView.tsx:27-29` —
`onVerify(record.digest, record.timestamp)`; `apps/console/src/App.tsx:24-29` —
`{ status: "verified", checkedAt }`;
`packages/ui/src/components/Attestation.tsx:66` —
`` `Re-derived and matched at ${state.checkedAt}.` ``. Asserted as correct in
`tests/e2e/flows.spec.ts:101-102`.

Click Verify at any moment and the console says *"Re-derived and matched at
2026-10-04 09:41 UTC"* — which is `ATTESTATION.timestamp`, the moment the record
was signed, not the moment it was checked. The code comment at
`AttestationsView.tsx:11-15` states the reason: *"The timestamp is part of the
record rather than read from a clock, so a re-run of the screenshot produces the
same pixels."* Screenshot determinism is being bought with a false statement in
the UI.

**Violates:** `project/README.md`, Voice — *"Short, exact, no adjectives."* and
rule 1, *"No claim without its evidence."* Also
`project/components/Attestation/README.md` — *"The card says who could have
produced this record; it never implies QED vouched for itself"* — the spirit of
which is that every assertion on this card is traceable. A verification timestamp
that is not the verification time is the one kind of imprecision this product
cannot afford.

**Severity:** blocking

**Fix:** have the shell inject the clock (`verify(digest, now())`), and keep the
screenshot deterministic by injecting a frozen clock in the test instead
(`page.clock.setFixedTime` or a `now` prop defaulted to `Date.now`). If no clock
is available, say *"Re-derived and matched."* with no time at all rather than a
wrong one.

---

### F-005 · G10's "at the 9px they ship at" check is taken at 4× device scale, and two of its three comparisons never compared a pixel

**File:** `tests/e2e/evidence.spec.ts:217-265` — the test docstring says *"The
glyphs again, at the 9px they actually ship at … this one proves the difference
survives the size the design system specifies, which is the question that matters
to a reader"*, and line 224 is `test.use({ deviceScaleFactor: 4 })` with
`screenshot({ scale: "device" })` at line 235. Gate: `scripts/verify.ts:894-915`.

Two separate defects:

1. **Wrong raster.** The evidence is a 36-device-pixel render of a 9-CSS-pixel
   glyph. It proves the three *paths* differ; it cannot prove the difference
   survives antialiasing at 9px, which is the stated question. Confirmed by
   dimensions: `.verify/shots/dot9-DIVERGED.png` is **40×40** for a 9px element.
2. **Sentinel values.** `scripts/png.ts:145` — `differenceRatio` returns `1` when
   the two bitmaps differ in size. `dot9-EQUIVALENT.png` is **36×40** while the
   other two are **40×40**, so after `cropToBitmap(…, side, side)` they are 36×36
   vs 40×40. `.verify/glyphs-9px.json` accordingly records
   `EQUIVALENT vs DIVERGED: 1` and `EQUIVALENT vs ABSTAINED: 1` — a perfect 1.0
   that means *"not compared"*, not *"completely different"*. The same two
   comparisons would read `1` if the glyphs were byte-identical.

`DECISIONS.md:110-111` then cites the one real number from this file — *"Measured,
in greyscale at the shipped 9px: `DIVERGED` and `ABSTAINED` now differ on 34% of
pixels. Gate G10 asserts that, at the large size and at 9px."* — which was not
measured at 9px.

**Violates:** `project/components/Verdict/README.md` — *"**Never colour alone.**
Every state owns a distinct glyph."* The gate that is supposed to machine-check
this does not check it.

**Severity:** blocking

**Fix:** (a) make `differenceRatio` throw on a dimension mismatch instead of
returning `1`, and have G10 fail on any ratio of exactly `1`; (b) run the 9px
comparison at `deviceScaleFactor: 1` with `screenshot({ scale: "css" })`, and
normalise the three captures to the same box (screenshot a fixed-size wrapper, not
the SVG). For reference, measuring the three dots straight out of the real product
render (`VerdictTable-paper-chromium-win32.png`, 1×, a 12×12 box around each dot,
luma tolerance 12/255) gives EQ↔DIV 28.5%, EQ↔ABS 17.4%, **DIV↔ABS 25.0%** — above
the 8% bar, but with the cross reduced to four ~1px specks, which is a far weaker
margin than "34%" implies.

---

### F-006 · One long symbol pushes every abstain reason off the terminal pane, and the committed baseline ships a truncated one

**File:** `packages/ui/src/model/terminal.ts:89-92` — column widths are the max
over the whole run, so one wide row widens every row;
`packages/ui/src/styles/terminal.css:6-12` (`max-width: var(--c-pane-max)` with
`white-space: pre` + `overflow-x: auto`).

**Rendered evidence:**
`tests/e2e/visual.spec.ts-snapshots/TerminalOutput-void-chromium-win32.png` and
`…-paper-…png`. The last data line reads
`○ ABSTAINED  api/handlers.go  CreateOrder  opens a database conne` — clipped
mid-word at the pane's content edge (measured: pane border x 25→712, content edge
x 687, text ink ends at 685). The visual-regression gate accepts this as the
correct baseline.

**Worse in the real product.** `apps/console/src/fixtures.ts:52-66` adds
`ledger/reconciliation/periodic.ts` (33 chars) and
`reconcileOutstandingSettlementBatches` (37 chars). The fixed prefix is then
`2 + 1 + 13 + 35 + 39 = 90` characters. Martian Mono at 13px measures ~9.2px per
advance (from the same screenshot: `$ qed check --base origin/main`, 30 chars,
ink x 51→321), so the evidence column starts at ~828px inside a pane whose content
width is `760 − 2 − 48 = 710px`. **Every input count and every abstain reason in
the console Run view starts ~118px past the right edge** and is only reachable by
horizontal scroll.

**Violates:** `project/README.md` rule 1 — *"No verdict renders without its input
count, its counterexample, or **the exact reason it abstained**. This is a layout
law, not a preference."* And `project/components/Terminal/README.md` —
*"Alignment is what makes a long run scannable."*

**Also falsifies DECISIONS D-016**, which claims 760px was chosen as *"the next
4px step that fits the output"* and `packages/tokens/src/component-tokens.json:46-49`
which says *"at 690px a one-clause abstain reason is cut off"* — the reason is cut
off at 760px too, and is cut off in the committed 688px baseline.

**Severity:** blocking

**Fix:** cap the path and symbol columns at a measure that fits the pane
(e.g. 28 and 24 characters) and middle-elide anything longer
(`ledger/…/periodic.ts`), so the evidence column has a fixed start; or move the
evidence onto its own indented continuation line when the prefix exceeds the pane.
Add an e2e assertion that the full `obstruction` string of every ABSTAINED row is
inside the pane's content box at the console's own layout width.

---

### F-007 · After one use of the theme toggle, the audit page prints in Void — a full-bleed black sheet

**File:** `packages/tokens/build.ts:180-186` —
`@media print { :root:not([data-theme]) { …paper… } }`;
`packages/ui/src/theme.tsx:42-44` — `setTheme` *always* writes
`data-theme` on `<html>`, for either value.

So the print override only fires on a document that has never been themed. Toggle
to Paper and back to Void (or toggle at all, since the bootstrap writes the stored
value at `theme.tsx:26-28`) and `<html data-theme="void">` is permanent — printing
the console, or exporting an attestation to PDF from the browser, yields the dark
theme: `bg #0b0b0b`, `proof-dim #0a7a45` ground, `ink #f6f5f1` text.

**Violates:** `project/README.md` §2 — *"**Void is the primary theme.** … Paper
exists for print, PDFs and the audit bundle."* And
`project/components/Attestation/README.md` — *"**Identical in PDF.** Same
geometry, same type, same rule weights at print scale. A reader who has seen one
on screen recognises the filed page."*

**Why no gate catches it:** `tests/e2e/evidence.spec.ts:268` calls
`open(page, …, "paper")`, which sets `data-theme="paper"` *before*
`page.pdf()` at line 271. G10 tests the one path that works. `DECISIONS.md:213-220`
(D-019) asserts *"`@media print` switches an unthemed document to Paper"* without
noticing that after any toggle no document is unthemed.

**Severity:** blocking

**Fix:** make the print block unconditional for Void:
`@media print { :root, [data-theme="void"] { …paper values… } }`, and add an e2e
case that loads the console with `data-theme="void"`, emits a PDF, and asserts the
page's mean luma is light.

---

## Should-fix

### F-008 · `proof-press` is used as a text colour, and the gate written to forbid it cannot see the one place it happens

**File:** `packages/ui/src/styles/base.css:71-73` —
`a:hover { color: var(--proof-press); }`

**Violates:** `project/tokens.json`, `proof-press` usage — *"The pressed state of a
proof surface. **Never used as a text colour.**"* A link hover colour is a text
colour.

**Gate is blind:** `scripts/verify.ts:229-246` checks
`evidence.textColoursUsed` for the `proof-press` hex, but
`tests/e2e/sweep.ts:23-105` reads `getComputedStyle` on the resting page only — it
never hovers anything. The single violation in the repo is a `:hover` rule, so
G1's `proof-press` assertion is unfalsifiable by its own evidence.
`DECISIONS.md:228-237` (D-021) presents this gate as the chosen, considered
replacement for a weaker one; it is not checking anything.

**Severity:** should-fix

**Fix:** use `proof-press` only as a surface; for link hover either keep `proof`
and change `text-decoration-thickness`, or introduce no new colour at all. Then
make the gate real: scan the *stylesheets* for `color:\s*var\(--proof-press\)` in
addition to sweeping the rendered page.

---

### F-009 · Every logo renders at 5/6 of its declared size, and G5's note claims otherwise

**File:** `packages/ui/src/components/Logo.tsx:16-22` (sizes 16/24/32/48/96),
`packages/ui/src/styles/logo.css:3-8` (`height: var(--qed-logo-size)`),
`packages/ui/src/generated/logos.ts:38,44` (`viewBox: "0 0 24 24"` with the mark
drawn from 2→22, i.e. 20 of 24 units).

**Measured** from `LogoMarks-void-chromium-win32.png` (green bbox per mark):

| `size` | declared | drawn          |
| -------- | -------- | -------------- |
| `xs`   | 16px     | **12px** |
| `sm`   | 24px     | **20px** |
| `md`   | 32px     | **26px** |
| `lg`   | 48px     | **40px** |

**Violates:** `packages/tokens/src/component-tokens.json:21-24`, which sources
`logo-xs: 16px` from `project/components/Attestation/README.md` — *"**Eyebrow**,
the mark at 16px in `proof`"*. The eyebrow mark is 13.3px. The same shift means
the system's optical boundary ("24px and below" / "32px and up") is applied to a
box 20% larger than the artwork it contains: a `md` logo nominally "32px and up"
draws a 26.7px mark.

**Gate is blind:** `tests/e2e/evidence.spec.ts:188-204` normalises everything to
the ink bounding box, so padding is invisible to it; the test's own comment at
line 135-137 says *"the mark still renders at 16px"*, and `README.md` repeats it
under G5 (*"The mark renders at 16/24/32/48px"*).

**Severity:** should-fix

**Fix:** either tighten the viewBox to the artwork (`viewBox="2 2 20 20"`) in
`scripts/generate-logos.ts` while keeping the `d` strings verbatim — which keeps
G4's hash intact — or scale `--qed-logo-size` by 24/20 in `logo.css`. Add an
assertion to G5 that `inkBoxHeight === size` within 1px.

---

### F-010 · G5's `cutEdgeFraction` cannot distinguish the two optical marks, and its threshold is met by a 20% cut

**File:** `scripts/verify.ts:666-670` (`if (render.cutEdgeFraction < 0.4)`),
`tests/e2e/evidence.spec.ts:191-199` (the measurement).

The metric counts non-ink pixels along the *bottom row of the ink bbox*, right
half only. For a diagonal cut of fraction `c` of the side, that evaluates to
`min(1, c / 0.5)`. The recorded evidence confirms it: `.verify/mark-optics.json`
reports `1.0` for both 16px and 24px (c = 0.52) and `0.906`/`0.913` for 32px and
48px (c = 0.46). So:

- the gate titled *"the cut still reads"* passes any cut ≥ 20% of the side;
- it cannot tell a 46% cut from a 52% cut, i.e. it cannot verify the geometry
  that distinguishes the two files the README says must never be interchanged;
- it never measures the corner radius at all — the *other* property that
  separates `qed-mark.svg` (5.5% smoothed) from `qed-mark-16.svg` (square);
- `render.variant` is read from the component's own `data-logo` attribute
  (`evidence.spec.ts:167`), so "the right optical variant" is confirmed by asking
  the component which one it picked.

**Violates:** `project/components/Logotype/README.md` — *"`qed-mark.svg` | 5.5% of
the side, continuous-curvature smoothing | 46% … `qed-mark-16.svg` | square |
52%"*.

**Severity:** should-fix

**Fix:** measure the cut as `1 − (inkWidthOfBottomRow / boxWidth)` and assert it
equals 0.46 ± 0.02 or 0.52 ± 0.02 according to the expected variant; and sample
the top-right corner pixel to assert it is ink for `mark-16` and background for
`mark`. Classify the variant from the rendered pixels, not from `data-logo`.

---

### F-011 · G4's "identical to the design system" baseline is generated from the repo's own files, and its shipped-output scan only validates paths that already look correct

**File:** `scripts/snapshot-logos.ts:13` — the baseline is hashed from
`packages/ui/src/assets/logos`, not from the artifact;
`scripts/verify.ts:607-618` — the shipped-output scan filters to
`/^M(?:3\.1|2\.0|37\.2|147\.886|214\.0|284\.28)/` before checking membership.

Two consequences:

1. Edit a logo SVG and re-run `pnpm exec tsx scripts/snapshot-logos.ts` and G4
   passes. `baseline.source` is a free-text string
   (`snapshot-logos.ts:15-16`); nothing verifies it.
2. A **redrawn** mark is invisible to the gate. The design system's own previews
   use a hand-rolled `M4 4 H20 V13 L13 20 H4 Z`
   (`project/components/Attestation/preview.html`,
   `project/components/Terminal/preview.html`) — exactly the kind of path a
   developer would copy. It does not match the prefix filter, so it is never
   compared. `[^"\\]{20,}` also skips any path under 20 characters. The `<rect>`
   elements of the wordmark are not checked in the shipped output at all.

**Violates:** the gate's own title — *"Logo fidelity - shipped path data identical
to the design system"* — and `project/assets/Logos/README.md`'s "Never … re-set
the wordmark in a font" / "outline it" family of rules, which only bite if a
redraw is detectable.

I did verify by hand that the four SVGs in `packages/ui/src/assets/logos/` are
**byte-identical** to the artifact's today. The finding is about the gate, not the
current files.

**Severity:** should-fix

**Fix:** commit the artifact's own bytes under `design-system/reference/logos/`
(the repo already mirrors the markdown there) and hash against *those*; and in the
shipped-output scan, flag any `<path d>` inside an SVG whose viewBox matches a
logo viewBox but whose `d` is not in the known set, instead of pre-filtering by
prefix.

---

### F-012 · `--border-rule` is used for the console nav indicator, against the token's "Nothing else"

**File:** `apps/console/src/console.css:53-70` —
`.con-nav-link { border-left: var(--border-rule) solid transparent }` and
`.con-nav-link[aria-current="page"] { border-left-color: var(--proof) }`.

**Violates:** `project/tokens.json`, `border-rule` usage — *"The attestation's
left rule and the focus ring. **Nothing else.**"* The 2px rule is the attestation's
seal; reusing it as a nav state makes the one place the brand asserts itself
(`project/components/Attestation/README.md`: *"the only component where the brand
colour appears as a surface"*) look like a menu item.

**Severity:** should-fix

**Fix:** mark the current nav item with `color: var(--ink)` plus
`background: var(--bg-raised)` (already there) and a `border-hair` rule, or with
weight, and reserve `border-rule` for the two uses named.

---

### F-013 · After "Skip to content", focus is invisible

**File:** `apps/console/src/App.tsx:71` (`<main id="main" tabIndex={-1}>`),
`apps/console/src/console.css:77-79` (`.con-main:focus { outline: none }`).

`.con-main:focus` is specificity (0,2,0) and beats
`:focus-visible { outline: … }` at (0,1,0) in `packages/ui/src/styles/base.css:54-58`.
A keyboard user who activates the skip link lands on a region with no indication
that focus moved. `tests/e2e/flows.spec.ts:29-30` asserts only that the URL
changed to `#main` — it never checks `document.activeElement` or the computed
outline.

**Violates:** `packages/ui/src/styles/base.css:50-53`'s own stated contract —
*"One ring, `focus`, 2px at 2px offset, on **every focusable thing**"* — and
`project/README.md` rule 5, which makes the focus treatment load-bearing. axe-core
does not test focus visibility, so G8 passes.

**Severity:** should-fix

**Fix:** delete `.con-main:focus { outline: none }` and let the global ring apply,
or move `tabIndex={-1}` onto the `<h1>` so the heading takes the ring and is
announced. Extend the keyboard test to assert
`document.activeElement.id === "main"` *and* a non-`none` computed `outline-style`.

---

### F-014 · Disabling the Verify button while it is focused drops focus to `<body>`

**File:** `packages/ui/src/components/Attestation.tsx:129-137` —
`disabled={checking}`.

A keyboard user presses Enter on "Verify independently"; the state goes to
`checking`; React re-renders the button as `disabled`; the browser removes focus
from a disabled element and resets it to `<body>`. The next Tab restarts from the
top of the document. (The `checking` state is a designed, screenshotted state —
`tests/gallery/main.tsx:268-274` — so this is reachable by design even though
`AttestationsView` currently skips straight to `verified`, which is itself a
separate gap: `checking`, `mismatch` and `error` are unreachable in the shipped
console.)

**Violates:** the system does not spell this out, but it is the direct consequence
of `project/README.md` rule 5 — the focus ring exists so *"a keyboard user is
never shown something that looks like a green pass"*; losing the ring entirely is
worse than mis-colouring it.

**Severity:** should-fix

**Fix:** use `aria-disabled="true"` with a no-op `onClick` guard instead of the
`disabled` attribute, so the element stays focusable and the `role="status"`
announcement is heard by a user whose focus has not moved.

---

### F-015 · The theme toggle's accessible name does not contain its visible label

**File:** `packages/ui/src/theme.tsx:87` —
`aria-label={`${label}: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}.`}`
with visible text `{THEME_LABEL[next]}`; same string hard-coded at
`apps/web/src/Layout.tsx:57` and `apps/web/prerender.ts:26`.

In Void the button reads **"Paper"** and its accessible name is **"Theme: Void.
Switch to Paper."** — the visible word happens to appear, but not as a leading
substring, and in the Paper theme the button reads "Void" against a name of
"Theme: Paper. Switch to Void." A speech-control user saying "click Paper" gets
no match in either direction with most engines. WCAG 2.5.3 (Label in Name) is in
G8's declared tag set (`wcag21a`), but axe-core has no automated rule for it, so
G8 reports zero violations.

**Severity:** should-fix

**Fix:** `aria-label={`${THEME_LABEL[next]} theme`}` (visible word first) and move
the current-state information to `aria-pressed` or a `<span class="qed-visually-hidden">`
inside the button.

---

### F-016 · In the CLI, EQUIVALENT and DIVERGED share one glyph, so with colour off only the word separates them

**File:** `packages/ui/src/model/verdict.ts:130-134` —
`EQUIVALENT: "●", DIVERGED: "●", ABSTAINED: "○"`, consumed by
`packages/cli-render/src/index.ts:59-68` whose `color: false` path emits plain
text.

The repo's *web* glyph set does carry three distinct shapes
(`packages/ui/src/components/verdict.tsx:24-46`: disc, cross-knockout, ring). The
CLI does not. `project/components/Terminal/README.md` does literally prescribe
`●` for both — but it opens with *"**Glyph before colour.** … Terminals get colour
turned off, pasted into tickets, and printed; the state has to survive all
three"*, and `project/components/Verdict/README.md` is unambiguous: *"**Never
colour alone.** Every state owns a distinct glyph."* Where the system contradicts
itself the load-bearing rule in the brand book (rule 2) should win, as
`DECISIONS.md` itself argues for D-002 and D-009. This contradiction is not in
`DECISIONS.md` at all.

Nothing tests the no-colour CLI output for state separability: G10 only looks at
the web glyphs.

**Severity:** should-fix

**Fix:** give DIVERGED its own character — `✗` (U+2717) or `⊗` (U+2297) — and
record the deviation in `DECISIONS.md` the way D-009 records the summary-line one.
Add a unit test on `renderRun(result, { color: false })` asserting the three
states' leading glyph characters are pairwise distinct.

---

### F-017 · A zero denominator reports "0%", which is the most misleading number available

**File:** `apps/console/src/views/ReleaseView.tsx:10-18` —
`rate()` returns `"0%"` when `verifiable === 0`; `coverage()` returns `"0%"` when
`changed === 0`.

A release where nothing could be verified gets an **ABSTAIN RATE of 0%** — i.e.
"nothing abstained", when in fact nothing could be run. The card's own note would
read "0 of 0 verifiable functions" beside it.

**Violates:** `project/README.md` rule 1 — *"No claim without its evidence"* — and
the Never list, *"a coverage figure without its abstain rate"*. A rate with no
denominator is not a rate. Also the Voice rule, *"Short, exact."*

**Severity:** should-fix

**Fix:** return `"—"` (or `"n/a"`) for a zero denominator and have the card render
the note alone, so the reader sees "no verifiable function in this release" rather
than a reassuring 0%. Same treatment in `apps/web/src/content.ts` if a measure
ever becomes computed.

---

### F-018 · The empty-run copy states something that is false, and the empty terminal prints no obstruction

**File:** `packages/ui/src/components/verdict.tsx:140` —
`empty = "No verifiable function changed in this run."`, rendered for `EMPTY_RUN`
in `apps/console/src/views/VerdictsView.tsx:24`.

`EMPTY_RUN` (`apps/console/src/fixtures.ts:87-93`) is `changedFunctions: 3, verifiableFunctions: 0`. Three functions *did* change; none was verifiable. The
sentence says the opposite.

Compounding it: `tests/e2e/visual.spec.ts-snapshots/TerminalOutputEmpty-void-…png`
shows the empty run printing `3 functions changed · 0 verifiable · 11s` and then
`0 equivalent · 0 divergences · 0 abstained · exit 0` — and **never says why the
three functions could not be run**. `RunView.tsx:53-56` even narrates it as a
feature: *"Three functions changed and none could be run soundly."*

**Violates:** `project/components/Verdict/README.md` — *"**Abstain reasons are
specific.** … Never 'could not verify'"* — and
`project/components/Terminal/README.md` — *"Hiding the abstains to make the output
look cleaner would remove the single thing that makes it credible."* Three
functions were effectively abstained and the output shows none of them.

**Severity:** should-fix

**Fix:** change the table's default empty text to
`"3 functions changed. None could be run soundly."` (parameterised from the run),
and make a run with no verifiable function emit an ABSTAINED line per changed
function with its obstruction, so the zero counts and the reasons agree. Note this
needs `RunResult` to carry the unverifiable functions, which it currently discards.

---

### F-019 · The same advertised run has three different "verifiable" counts, and "abstain rate" means two different ratios

**File:** `apps/web/src/content.ts:9-13` (`verifiableFunctions: 6`, 6 rows) and
`:132-135` (`"6"` / `"VERIFIABLE OF 41"`); `apps/console/src/fixtures.ts:13-17`
(`verifiableFunctions: 7`, 7 rows); `tests/gallery/main.tsx:87-93`
(`verifiableFunctions: 3`). All three print
`41 functions changed · N verifiable · 2m 14s` for `qed check --base origin/main`
on `acme/ledger`, with the same first three functions.

Separately: `apps/web/src/content.ts:126-130` publishes **"31% ABSTAIN RATE … of
changed functions"**, while `apps/console/src/views/ReleaseView.tsx:10-13`
computes the column headed `ABSTAIN RATE` as `abstained / verifiable` (29% for the
same release). Two different denominators under one label, on two surfaces of one
product.

**Violates:** `project/README.md`, Voice — *"Short, exact"* — and the Never list,
*"a verdict without a number beside it"*, whose point is that the numbers are
load-bearing. The brand position is literally *"publishing the limit is what makes
the claim believable."*

**Severity:** should-fix

**Fix:** share one fixture between `apps/web`, `apps/console` and the gallery, and
fix one definition of abstain rate (`abstained / verifiable` is the defensible
one) and state the denominator in the label on both surfaces.

---

### F-020 · On Paper the attestation's hairline and foot rule are invisible (1.03:1), and D-004 means no gate looks

**File:** `packages/ui/src/styles/attestation.css:9` (`border: var(--border-hair) solid var(--rule)`) and `:73` (`border-top: var(--border-hair) solid var(--rule)`).

Computed from `packages/tokens/src/tokens.json`: `rule` on `proof-dim` is
**1.03:1 in Paper** (`#e3e1d9` on `#b9f0d4`) against 2.87:1 in Void. Visible in
`AttestationNoTolerance-paper-chromium-win32.png`: the foot rule is barely
present and the card's own border does not read at all against its ground.

**Violates:** `project/components/Attestation/README.md` anatomy — *"**Foot**, a
hairline rule, the Rekor index and digest in `mono-sm`, and the verify action"* —
and `project/tokens.json`, `rule` usage: *"Every border and divider in the
product. The system has one hairline."* The system's one hairline disappears on
the system's one tinted ground, which is the one component whose job is to look
identical on screen and in print.

**Gate is blind:** `BORDER_EXEMPTIONS` (`scripts/verify.ts:179`) exempts `rule`
and `rule-strong` from any contrast check, reasoned in `DECISIONS.md:62-72`
(D-004). The exemption's argument is that *"no control in this repo depends on a
hairline to be found"* — true, but it also means no one noticed the foot rule
vanish on the one surface the brand book says is *"what the enterprise tier
sells."*

**Severity:** should-fix

**Fix:** on the attestation, use `rule-strong` for the foot rule and the card
border (Paper: `#c5c2b7` on `#b9f0d4` ≈ 1.4:1 — still weak) or, better, derive the
attestation's hairline from `proof` at a reduced step so it sits on its own
ground. Add the pair to G1 as a `nonText` entry and record the result rather than
the exemption.

---

### F-021 · Paper's terminal pane is `bg-raised`, so the sunk/raised relationship inverts between themes

**File:** `packages/ui/src/styles/terminal.css:23-25` —
`[data-theme="paper"] .qed-pane { background: var(--bg-raised); }`

**Violates:** `project/components/Terminal/README.md` — *"The pane itself is
`bg-sunk` with a hairline border at `radius-2`"* — and `project/tokens.json`,
`bg-sunk` usage: *"Terminal panes and code fields."* In Void the pane is one step
**below** the page (`#000` on `#0b0b0b`); in Paper it is one step **above**
(`#ffffff` on `#faf9f6`). The product's hero surface reads as a well in one theme
and as a card in the other.

`DECISIONS.md:74-83` (D-005) defends this on contrast: `proof` is 4.24:1 on
Paper's `bg-sunk`. That number is right, but the deviation is the wrong lever.
`bg-sunk` on Paper (`#f1efe8`) is then used **nowhere in either product** except
`apps/web/src/web.css:212-219` (`.web-docs-code`), so the token the system
designates for "terminal panes and code fields" has been retired from the terminal.
The attestation's own precedent (D-002) was to change the *text* colour, not the
*surface*: the same move here — EQUIVALENT in `ink` with the glyph carrying the
state — keeps the surface and satisfies the contrast note.

**Severity:** should-fix

**Fix:** keep `bg-sunk` in both themes and, on Paper, render the verdict words in
`ink` with the glyph carrying the state (exactly as the attestation already does),
or ask the design system to darken Paper's `proof` to clear 4.5:1 on `#f1efe8`.
Either way record the pane colour as a gate assertion rather than a theme override.

---

### F-022 · G1 declares no `proof`-on-`proof-dim` pair, though that is the attestation's eyebrow mark

**File:** `scripts/verify.ts:125-169` — `DECLARED_PAIRS` contains
`ink`/`proof-dim` and `focus`/`proof-dim`, and nothing else on that ground.

`packages/ui/src/components/Attestation.tsx:86` renders
`<Logo variant="mark" size="xs" decorative />` whose ink is `proof`
(`packages/ui/src/generated/logos.ts:40`) on the `proof-dim` card — **3.14:1**,
which scrapes past the 3:1 non-text bar with no margin, and is not declared.
`tests/e2e/sweep.ts:75-80` only looks at elements with their own *text* nodes, so
no SVG fill is ever swept. `DECISIONS.md:49-50` (D-002) states the 3.14:1 figure
and calls it cleared — but the gate does not assert it, so a future token change
would not fail anything.

**Severity:** should-fix

**Fix:** add `{ fg: "proof", bg: "proof-dim", kind: "nonText", where: "attestation eyebrow mark" }` to `DECLARED_PAIRS`, and extend the sweep to record
`fill`/`stroke` on `svg [data-logo]` and `svg.qed-dot` against their ground.

---

### F-023 · G7 records an expectation it never checks

**File:** `scripts/verify.ts:748-752` (the `TypeTestEvidence` interface declares
`expectedErrors`) and `:764-770` (the loop only tests `t.actualErrors === 0`);
`scripts/type-tests.ts:88` hard-codes `expectedErrors: 1` for every file.

So `.verify/type-tests.json` carries an "expected" column that is a constant and
is never compared. A negative test that fails for a reason unrelated to the rule
it names still passes the gate. (The `INFRASTRUCTURE_CODES` filter at
`type-tests.ts:43,62-64` mitigates the worst case — unresolved imports — but not,
say, a typo in a prop name that would make any file fail.)

**Severity:** should-fix

**Fix:** record the TS error *code* and the 1-based line each negative test
expects, assert both in G7, and drop `expectedErrors` or make it real.

---

### F-024 · G10's PDF assertion is satisfied by a blank page

**File:** `scripts/verify.ts:871-876` — `if (evidence.pdf.bytes < 2000)`.

A Chromium `page.pdf()` of an empty document is already several KB; the recorded
value is 102,326 B. The gate titled *"Print - the attestation survives greyscale"*
never opens the PDF: it does not check that the attestation is in it, that
`.qed-attestation-foot .qed-button` was hidden by the print rule
(`packages/ui/src/styles/attestation.css:106-113`), that the `proof` left rule
printed, or that `printBackground` preserved the ground.

**Violates:** `project/components/Attestation/README.md` — *"**Identical in PDF.**
Same geometry, same type, same rule weights at print scale."* Nothing checks
anything about the PDF except that it is larger than a few kilobytes.

**Severity:** should-fix

**Fix:** screenshot the attestation with
`page.emulateMedia({ media: "print" })` and compare it against a committed Paper
baseline — that gives "identical in PDF" a pixel definition — and assert the
Verify button is not in the print render.

---

### F-025 · The focus ring has no visual baseline; the `FocusRing` shot contains no ring

**File:** `tests/gallery/main.tsx:193-197` — the shot renders
`<FocusRing><a …>A link inside a composite</a></FocusRing>` and nothing ever
focuses the link. `tests/e2e/visual.spec.ts:12-29` just screenshots the element.

**Rendered evidence:** `FocusRing-void-chromium-win32.png` is a green underlined
link on black. No ring.

**Violates:** `project/README.md` rule 5 — *"`focus` is the one colour that is
neither brand nor verdict: a 2px ring at 2px offset"* — a load-bearing rule with
zero pixel coverage. G6 counts `FocusRing` toward *"every component is shot in
both themes"* and it passes, because the link colour differs between themes.
`tests/e2e/flows.spec.ts:60-89` checks the ring's *computed* properties on one
button, which is useful but does not show the ring against `proof-dim`,
`bg-sunk`, or inside a composite.

**Severity:** should-fix

**Fix:** focus the link before screenshotting (`await shot.locator("a").focus()`
for shots whose name starts with `Focus`), and add focused baselines for a button
on `proof-dim`, a link in a table row, and the two `[tabindex=0]` scroll regions.

---

### F-026 · At narrow widths the verdict table squeezes instead of scrolling, so its scroll region can never engage

**File:** `packages/ui/src/styles/controls.css:89-93` — `.qed-table { width: 100% }`
with no `min-width`; `:136-138` — `.qed-table-scroll { overflow-x: auto }`;
`packages/ui/src/components/verdict.tsx:143` wraps it in a focusable
`role="group"`.

At a 320px viewport the console's `.con-main` gives ~288px, so the three columns
resolve to roughly 86px / 75px / 127px. `.qed-fn { overflow-wrap: anywhere }`
(`packages/ui/src/styles/verdict.css:70-73`) then breaks paths and identifiers
mid-token — `VerdictTableLongStrings-void-chromium-win32.png` already shows
`reconcileOutstandingSettlement` / `BatchesForPeriod` at **1024px**; at 288px it
becomes a column of 8-character fragments. Because the table never exceeds its
container, `overflow-x: auto` never produces a scrollbar: the component ships a
keyboard-focusable scroll affordance that is permanently inert, which is itself a
focus-order problem (a tab stop that does nothing).

**Violates:** `project/components/Terminal/README.md`'s stated principle —
*"Alignment is what makes a long run scannable; a verdict list that wraps is a
verdict list nobody reads"* — applied to the same content in the same product; and
`project/components/Verdict/README.md`'s table anatomy, which assumes a numeral
column and a chip on one line.

**Severity:** should-fix

**Fix:** give `.qed-table` a `min-width` (e.g. `48ch`) so the wrapper actually
scrolls, and drop `tabIndex={0}`/`role="group"` when the content fits (set it from
a resize observer, or accept the always-on tab stop only once the min-width makes
it meaningful). Below `bp-stack`, consider collapsing each row to a stacked
definition block.

---

### F-027 · G6 inherits the same "different size ⇒ ratio 1" sentinel, so a theme that fails to switch but reflows would pass

**File:** `scripts/verify.ts:728-738` — `differenceRatio(a, b)` with the
`< 0.1` failure test; `scripts/png.ts:145` returns `1` on a dimension mismatch.

If a Paper render reflows to a different height (a very common outcome of a
font-metric or wrapping change), the gate records `1.0` — "themes differ on 100% of
pixels" — without comparing anything. The notes it prints
(*"X: themes differ on 100% of pixels"*) then read as a strong pass. This is the
same defect as F-005 but in a gate where it has not yet fired.

**Severity:** should-fix

**Fix:** same remedy — make `differenceRatio` throw on a mismatch and have G6 fail
explicitly with "void and paper renders are different sizes", which is itself
worth knowing.

---

## Taste

### F-028 · G2's purity scan misses several literal forms and two source trees

**File:** `scripts/verify.ts:266` (`PURITY_ROOTS` = `packages/ui`, `apps/web`,
`apps/console`) and `:284`
(`LENGTH_RE = /(?<![\w-#])(\d*\.?\d+)(px|rem|pt)(?![\w-])/g`).

`em`, `%`, `ch`, `vw`, `vh` and unitless SVG geometry attributes are not matched,
so `max-width: 66ch` (`layout.css:41`), `minmax(28ch, 1fr)` (`layout.css:48`),
`grid-template-columns: 26ch 1fr` (`console.css:37`) and `stroke-width="1.6"`-style
values all pass a gate titled *"no raw colour/size literals"*.
`packages/cli-render` — which paints with 24-bit ANSI derived from tokens, and
which could trivially hard-code a hex — and `tests/gallery` are not scanned at all.

This is not currently being abused (I checked: no hex literals in `cli-render`),
so it is a gate-strength note rather than a live violation.

**Severity:** taste

**Fix:** add `em|ch|vw|vh` to `LENGTH_RE` with an allowlist for the handful of
intentional `ch` measures (each cited, as `component-tokens.json` already does for
px), and add `packages/cli-render` to `PURITY_ROOTS`.

---

### F-029 · Chip right padding is 12px where the README says 10px

**File:** `packages/ui/src/styles/verdict.css:29` —
`padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2)`.

**Violates:** `project/components/Verdict/README.md` — *"Chip: 1px `rule` border,
`radius-1`, `bg-raised`, 8px padding-left, 10px right."*

`DECISIONS.md:162-166` (D-013) is a reasonable call — 10px is off the 4px grid —
but the asymmetry the README asks for exists for an optical reason (the chip's
last glyph is a lining numeral or a lowercase letter, the first is a 9px disc), and
8/12 overshoots it. The visible result in `VerdictChip-void-chromium-win32.png` is
a chip that reads right-heavy.

**Severity:** taste

**Fix:** keep 8/12 but tighten the gap between word and count from `space-2` to
`space-1` + a `0.08em` optical nudge; or accept the README's 10px as a one-off
`--c-chip-pad-right` the way `--c-dot-size: 9px` is already an accepted off-grid
value, with the same citation.

---

### F-030 · The marketing step list reuses the attestation's 132px label column for a two-character number

**File:** `apps/web/src/web.css:90-95` —
`.web-step { grid-template-columns: var(--c-field-column) 1fr; gap: var(--space-6) }`.

`--c-field-column` is 132px, sourced in `component-tokens.json:16-19` from
*"`label` keys against `mono` values at a 132px column"* in the Attestation README.
A step number is `"01"` — about 20px of `mono-sm`. The result is ~136px of empty
space between the numeral and its heading, on a page whose adjacent sections use a
24px rhythm.

**Severity:** taste

**Fix:** use a dedicated step column (`4ch` + `space-6`) or set the numeral
flush-left above the heading. Do not borrow a token whose stated source is a
different component.

---

### F-031 · The footer explains the brand rule instead of stating a fact, and the claim has no number

**File:** `apps/web/src/Layout.tsx:75-78` — *"Every claim on this page carries its
number. The abstain rate is on the home page, not in a footnote."*

**Violates:** `project/README.md`, Voice — *"Short, exact, no adjectives."* and
the Never list — *"a verdict without a number beside it"*. This is brand-book
commentary shipped as product copy, and it is itself a claim with no number
standing in the footer. The same self-narration appears at
`apps/console/src/views/ReleaseView.tsx:86-89` (*"A coverage figure without its
abstain rate is not reported here, in the product or anywhere else"*) and
`AttestationsView.tsx:32-35` (*"dropping it to save space is the difference between
evidence and a badge"*).

**Severity:** taste

**Fix:** replace with a fact — `QED · deterministic verification · 31% abstain rate, last 30 days` — and let the layout demonstrate the rule rather than
announcing it.

---

### F-032 · A comment in `base.css` claims the opposite of what the rule does

**File:** `packages/ui/src/styles/base.css:60-63` —
`/* Keep the ring when a mouse gives focus to a scrollable region, too. */`
followed by `:focus:not(:focus-visible) { outline: none; }`, which *removes* the
ring in exactly that case.

**Severity:** taste

**Fix:** either delete the rule (it is already the UA default once
`:focus-visible` is used) or fix the comment. If keeping the ring for mouse-focused
scroll regions is actually wanted, add
`.qed-table-scroll:focus, .qed-pane-scroll:focus { outline: var(--border-rule) solid var(--focus); }`.

---

### F-033 · The design system's `WARRANT` banner string, and the 14px banner mark, are both resolved sensibly but worth re-raising upstream

**File:** `packages/ui/src/model/terminal.ts:67-72` emits
`QED · DETERMINISTIC VERIFICATION`; `packages/ui/src/components/TerminalOutput.tsx:57`
uses `size="xs"` (16px box → 12px drawn mark).

`project/components/Terminal/README.md` says the banner carries
`WARRANT · DETERMINISTIC VERIFICATION` and *"the mark at 14px"*; its own
`preview.html` says `QED` and the brand book is titled QED throughout.
`DECISIONS.md:21-29` (D-001) and `:174-178` (D-015) both choose correctly. The
note here is only that the repo directory is itself named `Warrant`, so the stray
string in the README is probably not residue but a live naming question the brand
book's closing section (*"On the name"*) already flags — and it should go back to
the design system rather than live on as a repo-local decision. **UNCONFIRMED**
which name is intended; a one-line answer from whoever owns the artifact settles it.

Separately, D-015's reasoning ("14px is off the 4px grid, used 16px") is sound but
moot: because of F-009 the banner mark actually draws at 12px, i.e. *further* from
the README's 14px than the 14px it rejected. Fixing F-009 will make the banner mark
13.3px → 16px and change this screenshot; decide the intended drawn size at that
point.

**Severity:** taste

**Fix:** raise `WARRANT` with the design system owner; after F-009, set the banner
mark explicitly (a `--c-logo-banner: 16px` drawn size, or re-adopt 14px as a cited
off-grid value beside `--c-dot-size: 9px`).

---

## Notes on things I checked and did not flag

- The four SVGs in `packages/ui/src/assets/logos/` and the six markdown files in
  `design-system/reference/` are **byte-identical** to the artifact (verified with
  `diff` against the files read from the artifact). G4's current pass is honest;
  F-011 is about the gate, not the files.
- `packages/tokens/src/tokens.json` is byte-identical to the artifact's
  `project/tokens.json`.
- The 2px `proof` left rule on the attestation renders correctly in **both**
  themes (sampled at y=250: Void `#12e27e` at x 25–26, Paper `#06824a` at x 25–26).
- The attestation prints every tolerance and control row even when empty
  (`AttestationNoTolerance-*.png`: "none recorded" / "none applied") — the
  README's hardest layout rule is honoured.
- The summary line prints all three counts including zeros
  (`TerminalOutputEmpty-*.png`), correctly overriding the system's own preview;
  D-009 is right.
- Exit is non-zero only on DIVERGED (`model/verdict.ts:97`,
  `cli-render/src/index.ts:96-98`).
- `mono` at 13/20 rather than the Terminal README's 13/21 (D-008) is correct:
  tokens.json and the 4px grid both say 20.
- The 9px dot, the 132px field column and the mark sizes are all declared in
  `component-tokens.json` with citations rather than hand-written — D-012 is a
  good pattern and G2 depends on it working.
- G9 (bundle budget) does what it says, including inline `<script>` bodies.
  It is not a design-system property, but it is not vacuous.

---

# Resolution — round 2

Every blocking and should-fix item below is fixed, or accepted with a reason.
Taste items are recorded as decisions. `pnpm verify` is green on all ten gates
after these changes, and four of the gates are now stricter than the review
found them.

## Blocking — all fixed

|                 | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-001** | `qed-mark-16.svg` is copied to `apps/*/public/favicon.svg` and linked from both heads. It is the same bytes as the design-system file, so G4 covers it.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **F-002** | The lockup is composed rather than shipped from`qed-logotype.svg`: `Logo.tsx` draws the wordmark plus whichever mark the *drawn* size calls for, placed by the Logotype README's own rule (0.78× x-height, gap 30 units, bottom-aligned to the baseline). The header and hero lockups now carry `mark-16`, confirmed from the live page: `data-lockup-mark="mark-16"` at both `sm` and `lg`.                                                                                                                                                                            |
| **F-003** | A record that did not re-derive loses its seal:`[data-verification="mismatch"]` drops the ground to `bg-raised`, turns the left rule `break`, and sets the reason in `break`. Covered by a new unit test.                                                                                                                                                                                                                                                                                                                                                                      |
| **F-004** | The console no longer restates the record's signing time.`verify()` runs the check, then reports the time the check ran.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **F-005** | `differenceRatio` returned `1` on a size mismatch, which made two of three comparisons constant. It is now `compareBitmaps`, which compares the overlapping region and reports `dimensionsMatch` separately; G6 and G10 fail on a mismatch instead of reading a sentinel. All glyph bitmaps are cropped to one common box before comparison. The 9px numbers are now real: 56%, 57%, 37%. The 4× device scale is kept deliberately — it rasterises the 9px CSS size finely, it does not change the size being rendered.                                                      |
| **F-006** | Column widths are derived from the terminal's own convention rather than from arbitrary caps:`buildRunLines` takes `columns` (default 80), shrinks the symbol column first and then the path column to fit, and gives any row that outgrows its column its own evidence line. `--c-pane-max` is now 776px — a measured 728px for 80 columns of Martian Mono at 13px, plus padding. One row with a 33-character path *and* a 37-character symbol still runs to 86 columns; it is wider than 80 characters of content, and it keeps its full names rather than being truncated. |
| **F-007** | The print rule is now`:root:not([data-theme="paper"])`, so a reader who has used the toggle still prints Paper. G10 reads the page back under print media emulation and asserts the ground, the five field rows, and that no control survives into print.                                                                                                                                                                                                                                                                                                                            |

## Should-fix — fixed

**F-008** link hover thickens the underline instead of reaching for `proof-press`.
**F-009** `size` now means the mark, not the box: the mark viewBox is tightened to the shape's own bounds, so `xs` renders exactly 16px.
**F-010** G5 checks the cut as a fraction of the side against the system's stated 46%/52% and checks whether the corner is square — measured 45.3/45.8% smoothed and 51.0/51.6% square, which is what tells the two files apart.
**F-011** The baseline is anchored to the four sha256 values the artifact itself published; `snapshot-logos.ts` refuses to write if a local copy differs. The shipped-output scan no longer pre-filters by prefix: every path inside a `.qed-logo` svg in the prerendered HTML must be a design-system path, and a bundle that contains the start of a logo path must contain all of it.
**F-012** The console's current-page indicator uses `border-hair`; `border-rule` is left to the attestation and the focus ring.
**F-013** `.con-main:focus { outline: none }` is gone, so the skip-link target shows focus.
**F-014** The Verify button is no longer disabled mid-check: it carries `aria-busy` and ignores further clicks, so focus stays on it. `checking` is now reachable in the shipped console.
**F-015** Changed, though the original was not a 2.5.3 violation — the visible word was already contained in the accessible name. The label now leads with it: "Switch to Paper theme (currently Void)".
**F-017** A rate with no denominator prints "—", not "0%".
**F-018** The empty states name their numbers: "3 functions changed. None could be run soundly, so none has a verdict."
**F-019** The marketing hero and the console now describe the same run, and the abstain rate is `abstained / verifiable` on both. The flow test derives the published figure from the fixture rather than asserting a literal, so the two cannot drift apart again.
**F-020** The attestation's border and foot rule use `rule-strong` — the most visible hairline available on that ground.
**F-022** `proof` on `proof-dim` (the eyebrow mark) and `ink` on `proof-dim` (the verdict glyph) are now declared pairs in G1.
**F-023** G7 compares `actualErrors` against `expectedErrors` instead of recording it and ignoring it.
**F-024** G10 no longer rests on a byte count: it reads the printed page back under print media.
**F-025** The FocusRing shot focuses its link first, so rule 5's treatment is actually in the baseline.
**F-026** `.qed-table` has `min-width: 52ch`, so the scroll container scrolls instead of the columns squeezing.
**F-027** Fixed with F-005: G6 fails on a dimension mismatch rather than reading it as a 100% difference.
**F-028** `packages/cli-render` is in G2's scope. `em` and `ch` stay allowed: both are type-relative and carry no fixed design value.
**F-030** The marketing step number has its own `--c-step-column`.
**F-031** The footer states figures — "Abstain rate 29% · 7 verifiable of 41 changed · median run 2m 14s" — instead of narrating the rule.
**F-032** The comment above the reduced-motion block says what the block does.

## Accepted, with reasons

**F-016 · The CLI gives EQUIVALENT and DIVERGED the same `●`.** This is the design system's instruction, stated twice: *"`●` for EQUIVALENT and DIVERGED, `○` for ABSTAINED"* (`components/Terminal/README.md`). With colour off the two are separated by the verdict word, which is text and is sufficient. The no-colour output is covered by a unit test that asserts all three glyph/word pairs. Changing it would put the CLI out of step with the system it was specified from; it belongs in the design system, not here.

**F-021 · Paper's terminal pane uses `bg-raised`.** The alternative the review prefers — fix the text rather than the surface, as D-002 does for the attestation — is not available here: the text is the verdict, `proof` is 4.24:1 on `bg-sunk` in Paper, and the only darker green is `proof-press`, which `tokens.json` declares must never be a text colour. Changing the surface is the only token-pure fix. Recorded as D-005.

**F-029 · Chip padding is 8/12, not 8/10.** 10px is not on the 4px grid the brand book states, and there is no 10px on the spacing scale. Recorded as D-013.

**F-033 · The `WARRANT` banner string and the 14px banner mark.** Agreed — both belong back in the design system rather than as repo-local decisions. Raised with the owner; recorded as D-001 and D-015.
