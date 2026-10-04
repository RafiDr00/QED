import type { ReactNode } from "react";

import {
  evidenceLine,
  formatCount,
  type FunctionRun,
  type Verdict,
  type VerdictState,
} from "../model/verdict.js";
import { Table } from "./Table.js";

/**
 * The verdict is the product. Three states, equal design weight, and never a
 * verdict without its evidence - the component cannot render one, because the
 * type cannot hold one.
 */

/**
 * Each state owns a distinct shape, not just a colour: filled, cross-filled,
 * hollow (components/Verdict/README.md). The cross and the hole are knocked
 * out of one path with fill-rule evenodd, so the glyph needs no second colour
 * and survives a greyscale print.
 */
const DISC = "M6 1A5 5 0 1 1 6 11A5 5 0 1 1 6 1Z";
const SALTIRE =
  "M6 7.414L4.374 9.041L2.959 7.626L4.586 6L2.959 4.374L4.374 2.959" +
  "L6 4.586L7.626 2.959L9.041 4.374L7.414 6L9.041 7.626L7.626 9.041Z";
const INNER = "M6 3A3 3 0 1 0 6 9A3 3 0 1 0 6 3Z";

const GLYPH_PATH: Readonly<Record<VerdictState, string>> = {
  EQUIVALENT: DISC,
  DIVERGED: `${DISC}${SALTIRE}`,
  ABSTAINED: `${DISC}${INNER}`,
};

export interface VerdictDotProps {
  state: VerdictState;
}

/**
 * The only round object in the system. Decorative by contract: the verdict
 * word is always rendered beside it, so the shape is never the sole carrier
 * for a screen reader either.
 */
export function VerdictDot({ state }: VerdictDotProps) {
  return (
    <svg
      className="qed-dot"
      data-state={state}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path d={GLYPH_PATH[state]} fillRule="evenodd" />
    </svg>
  );
}

export interface VerdictChipProps {
  verdict: Verdict;
  /** In tables the chip loses its border and sits inline. */
  bare?: boolean;
  /** Hide the evidence clause when the row carries it in its own column. */
  evidence?: boolean;
}

export function VerdictChip({
  verdict,
  bare = false,
  evidence = true,
}: VerdictChipProps) {
  return (
    <span className="qed-chip" data-bare={bare} data-state={verdict.state}>
      <VerdictDot state={verdict.state} />
      <span className="qed-chip-word t-verdict">{verdict.state}</span>
      {evidence ? (
        <span className="qed-chip-evidence t-mono-sm">
          {evidenceLine(verdict)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The evidence column. "the evidence column carries the count at `numeral`
 * size, because the number is what a reviewer looks at before any word."
 */
export function VerdictEvidence({ verdict }: { verdict: Verdict }): ReactNode {
  switch (verdict.state) {
    case "EQUIVALENT":
      return (
        <>
          <span className="qed-numeral t-numeral">
            {formatCount(verdict.inputs)}
          </span>{" "}
          <span className="qed-evidence-note t-mono-sm">
            generated inputs, 0 divergences
          </span>
        </>
      );
    case "DIVERGED":
      return (
        <span className="qed-evidence-note t-mono-sm">
          <code className="qed-code">{verdict.counterexample.input}</code>{" "}
          &rarr; base <strong>{verdict.counterexample.base}</strong>, head{" "}
          <strong>{verdict.counterexample.head}</strong>
        </span>
      );
    case "ABSTAINED":
      return (
        <span className="qed-evidence-note t-mono-sm">{verdict.obstruction}</span>
      );
  }
}

export interface VerdictTableProps {
  caption: string;
  captionVisible?: boolean;
  runs: readonly FunctionRun[];
  empty?: ReactNode;
}

export function VerdictTable({
  caption,
  captionVisible = false,
  runs,
  empty = "No verifiable function changed in this run.",
}: VerdictTableProps) {
  return (
    <div className="qed-table-scroll" tabIndex={0} role="group" aria-label={caption}>
      <Table<FunctionRun>
        caption={caption}
        captionVisible={captionVisible}
        rows={runs}
        rowKey={(run) => `${run.path}:${run.symbol}`}
        empty={empty}
        columns={[
          {
            key: "function",
            header: "FUNCTION",
            width: "30%",
            rowHeader: true,
            cell: (run) => (
              <span className="qed-fn t-mono">
                {run.path} <span aria-hidden="true">&rsaquo;</span>{" "}
                <span className="qed-fn-symbol">{run.symbol}</span>
              </span>
            ),
          },
          {
            key: "verdict",
            header: "VERDICT",
            width: "26%",
            cell: (run) => <VerdictChip verdict={run.verdict} bare evidence={false} />,
          },
          {
            key: "evidence",
            header: "EVIDENCE",
            cell: (run) => <VerdictEvidence verdict={run.verdict} />,
          },
        ]}
      />
    </div>
  );
}
