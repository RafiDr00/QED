# QED

**∎ Proven, or it says so.**

*Quod erat demonstrandum.* The three letters an engineer already knows, and the tombstone `∎` that has closed every proof since Halmos. A product that runs your code and tells you whether a change altered behaviour has exactly one job: end the argument. The name does that in three characters.

The identity is three decisions and nothing else.

---

## 1. The mark is the tombstone — and the wordmark is drawn

**A filled square with one corner cut.** The square is `∎`, end of proof. The cut is the part that is honest: the system does not always finish the proof, and it says so.

The three intact corners are smoothed with **cubic curves at a 0.70 handle ratio**, not circular arcs — a squircle, so the curve never shows the flat spot a plain radius leaves where it meets the straight edge. The cut stays razor-sharp against them. That contrast is the whole character of the shape.

**Two optical sizes, because one does not work.** At 32px and up: corners 5.5% of the side, cut 46%. At 24px and below: corners square, cut 52% — at favicon size the smoothing closes up and the cut stops reading, so the small file bites deeper. Shipping one mark for both sizes is the mistake this pair exists to prevent.

**The wordmark is drawn, not set.** Three lowercase letters on one circle: x-height 72, stem 15, bowl 74.4 outer and 44.4 inner, letter gap 14. The bowls **overshoot** the baseline and x-height by 1.2 units, because a circle that stops exactly on the line reads smaller than the flat stem beside it. And the `e` aperture is cut at **45°** — the same angle as the mark's corner, so wordmark and mark read as one object rather than two.

Drawn means no font licence, no rendering difference between a browser and a laser cutter, and no stretched grotesk anyone can identify.

**Lockup:** mark trailing the wordmark, bottom-aligned to the baseline, at 0.78× the x-height. Lowercase always. **Clear space** is 7 units — the height of the cut — on all four sides.

---

## 2. One colour, and it means proven

The system owns **one** colour: `proof` — `#12e27e` on Void, `#06824a` on Paper.

It is the logo. It is links. It is the primary button. It is also the EQUIVALENT verdict — and that collision is the entire brand position, stated in a palette:

> **The brand colour and the success colour are the same colour. We only sell one thing.**

Everything else is black, white and two greys. `break` (vermilion) exists for DIVERGED. `open` (neutral grey) exists for ABSTAINED. Neither ever appears on a surface, a button or a piece of marketing — they are results, not decoration.

No gradient. No second accent. No violet, no indigo, no cyan. A brand that spends colour everywhere has none left for the thing that matters.

**Void is the primary theme.** The product lives in a terminal and on a dark pull-request page, and green on true black is the single most recognisable image the company has. Paper exists for print, PDFs and the audit bundle.

**Honest contrast note:** `#12e27e` is a 4.9:1 on Void and reads beautifully; its Paper counterpart is darkened to `#06824a` to clear 4.5:1 on white. Every verdict also carries a glyph — `●` proven, `●` broken, `○` abstained — so the system survives colour-blindness and the black-and-white printout a regulator actually reads.

---

## 3. One typeface, on a 4px baseline

**Instrument Sans** for everything written, **Martian Mono** for everything the machine produced.

Instrument Sans is slightly narrow, with open apertures and a low contrast that holds at 11px — it sets a dense verdict table and a 56px headline in the same voice. Narrow matters here: the product's surfaces are tables of paths, symbols and counts, and a wide grotesque would force a line break on every row. Hierarchy comes from weight and size, never from a second personality.

Martian Mono carries CLI output, hashes, inputs and the three verdict words. Semi-condensed, engineered, with an unmistakable `0`/`O` — which matters when a reviewer is comparing commit digests. It makes a terminal look like an instrument reading rather than a chat log.

**Every line height is a multiple of 4.** 16 / 20 / 24 / 28 for text, 32 / 36 for numerals, 56 and 88 for display. Type, spacing and radii all sit on the same 4px grid, so a card is never one pixel off a neighbour.

*Rejected: Inter, Geist and Space Grotesk — competent, and instantly legible as the 2026 default stack. Archivo stretched to width 125 for display, which is what the first draft did: serviceable, and a stretched grotesk is the first thing a designer spots. A display serif, which aged the brand a decade in the wrong direction. Any pairing of two written voices, because the systems people remember are the simplest ones.*

---

## The rules that are load-bearing

1. **No claim without its evidence.** No verdict renders without its input count, its counterexample, or the exact reason it abstained. This is a layout law, not a preference.
2. **Colour never carries a verdict alone.** Glyph first, colour second.
3. **Nothing glows.** No shadows, no gradients, no glass. Rules and space do the work. Evidence that looks persuasive is less trustworthy than evidence that looks plain.
4. **Square by default.** `radius-0` is the system, `radius-1` for inputs and chips, `radius-2` as the ceiling for any rectangle, and exactly one round object in the product — the verdict dot. The mark's `radius-mark` is a *percentage*, not a pixel value, so the curve scales with the logo instead of flattening at display size.
5. **Interaction is never a result.** `focus` is the one colour that is neither brand nor verdict: a 2px ring at 2px offset, so a keyboard user is never shown something that looks like a green pass.

## Voice

Short, exact, no adjectives. *"Equivalent on 18,402 generated inputs."* Never *"safe."* *"Cannot verify — this function opens a database connection."* Never *"looks fine."* The abstain rate goes on the home page, not in a footnote: publishing the limit is what makes the claim believable.

No *revolutionary*, no *AI-powered*, no *seamless*. Half the buyers are safety engineers, and that vocabulary reads to them as a warning.

## Never

A second accent colour · a gradient of any kind · a shadow doing a border's job · the mark in `break` or `open` · a verdict without a number beside it · a coverage figure without its abstain rate · rounded, friendly geometry · an emoji in product UI.

---

**On the name.** `qed.dev` and the three-letter handles need checking before this is locked, and QED Investors exists in a different trademark class (venture capital, not software tooling) — worth twenty minutes with a trademark search. If it does not clear, the identity survives the rename intact: the tombstone, the one green and the single typeface are the brand, and the word is the smallest part of it.
