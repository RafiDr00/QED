The CLI output is the product's most-shared surface, so it is designed as deliberately as any screen.

## Rules

**Glyph before colour.** `●` for EQUIVALENT and DIVERGED, `○` for ABSTAINED. Terminals get colour turned off, pasted into tickets, and printed; the state has to survive all three.

**Three fixed columns** — verdict, path, symbol — then evidence ragged right in `ink-muted`. Alignment is what makes a long run scannable; a verdict list that wraps is a verdict list nobody reads.

**Counterexamples indent under their verdict** with four labelled lines: `input`, `base`, `head`, `repro`. The repro line is a complete command, copyable without editing.

**The summary line states all three counts**, always, including zeros. "1 divergence · 2 abstained · exit 1".

**Exit non-zero only on DIVERGED.** Abstaining is not a failure and must never break a build.

## Type and colour

Everything sets in `mono` (Martian Mono 13/21). Verdict words take 600 weight and their state colour; paths and symbols take `ink`; all evidence takes `ink-muted`. The pane itself is `bg-sunk` with a hairline border at `radius-2` — the product reads from this surface rather than writing to it.

The banner carries the mark at 14px and `WARRANT · DETERMINISTIC VERIFICATION` in `label`. It appears once per invocation, never per line.

## Never

Spinners that outlive the run, progress bars with fake smoothness, emoji, boxes drawn in Unicode art, or a summary that reports only the failures. Hiding the abstains to make the output look cleaner would remove the single thing that makes it credible.
