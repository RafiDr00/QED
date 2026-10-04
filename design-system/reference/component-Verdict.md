The verdict is the product, and all three states carry equal design weight — a system that made abstaining look like a failure would be lying for aesthetic reasons.

## The three states

| State | Colour | Glyph | Always accompanied by |
| --- | --- | --- | --- |
| `EQUIVALENT` | `proof` | filled circle | the input count |
| `DIVERGED` | `break` | cross-filled circle | the minimised counterexample |
| `ABSTAINED` | `open` | hollow circle | the exact obstruction, in one clause |

## Rules

**Never colour alone.** Every state owns a distinct glyph. A regulator reads the audit bundle as a black-and-white printout, and roughly one reader in twelve cannot separate green from red by hue.

**Never a verdict without its evidence.** `EQUIVALENT` with no count is a claim, not a result. If the count is unknown the state is `ABSTAINED`, not green.

**Abstain reasons are specific.** "Opens a database connection", "depends on wall-clock time", "parameter `cfg` has no type annotation". Never "could not verify".

**One verdict word per row.** The verdict word sets in `verdict` — Martian Mono, 12px, 600, tracked 0.08em — and that type style exists for exactly three strings in the whole product.

## Anatomy

Chip: 1px `rule` border, `radius-1`, `bg-raised`, 8px padding-left, 10px right. Glyph 9px at `radius-round` — the only round shape in the system. Gap 8px between glyph, word and count. The count sets in `mono-sm`, `ink-muted`.

In tables the chip loses its border and sits inline; the evidence column carries the count at `numeral` size, because the number is what a reviewer looks at before any word.

## Never

Render a fourth state. Use `proof` for anything that is not the brand or a proven verdict. Use a verdict colour for anything that is not a verdict. Put a percentage on a verdict — the engine does not produce confidence, and a number between 0 and 1 would invite exactly the probabilistic reading the product exists to replace.
