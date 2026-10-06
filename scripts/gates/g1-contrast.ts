import { contrastHex, round2 } from "../color.ts";
import {
  fail,
  pass,
  readEvidence,
  themeIds,
  tokenHex,
  type Gate,
} from "./kit.ts";

// =============================================================== G1 contrast

/**
 * Pairs the gate asserts at token level, on top of the runtime sweep. Each is
 * a real surface in the product; `kind` sets the WCAG threshold.
 */
const DECLARED_PAIRS: {
  fg: string;
  bg: string;
  kind: "body" | "large" | "nonText";
  where: string;
  /** Omitted means both themes. */
  themes?: string[];
}[] = [
  { fg: "ink", bg: "bg", kind: "body", where: "page body copy" },
  { fg: "ink", bg: "bg-raised", kind: "body", where: "card body copy" },
  { fg: "ink", bg: "bg-sunk", kind: "body", where: "terminal output" },
  { fg: "ink", bg: "proof-dim", kind: "body", where: "attestation body" },
  { fg: "ink-muted", bg: "bg", kind: "body", where: "metadata" },
  { fg: "ink-muted", bg: "bg-raised", kind: "body", where: "table second line" },
  { fg: "ink-muted", bg: "bg-sunk", kind: "body", where: "terminal evidence" },
  { fg: "proof", bg: "bg", kind: "body", where: "links, EQUIVALENT" },
  { fg: "proof", bg: "bg-raised", kind: "body", where: "verdict chip word" },
  {
    fg: "proof",
    bg: "bg-sunk",
    kind: "body",
    where: "terminal EQUIVALENT",
    // Void only: on Paper the pane sits on bg-raised, because `proof` is
    // 4.24:1 on bg-sunk there. See terminal.css and DECISIONS.md D-005.
    themes: ["void"],
  },
  { fg: "break", bg: "bg", kind: "body", where: "DIVERGED" },
  { fg: "break", bg: "bg-raised", kind: "body", where: "verdict chip word" },
  { fg: "break", bg: "bg-sunk", kind: "body", where: "terminal DIVERGED" },
  { fg: "open", bg: "bg", kind: "body", where: "ABSTAINED" },
  { fg: "open", bg: "bg-raised", kind: "body", where: "verdict chip word" },
  { fg: "open", bg: "bg-sunk", kind: "body", where: "terminal ABSTAINED" },
  { fg: "bg-raised", bg: "proof", kind: "body", where: "primary button label" },
  { fg: "bg-raised", bg: "proof-press", kind: "body", where: "pressed button label" },
  { fg: "focus", bg: "bg", kind: "nonText", where: "focus ring on page" },
  { fg: "focus", bg: "bg-raised", kind: "nonText", where: "focus ring on card" },
  { fg: "focus", bg: "bg-sunk", kind: "nonText", where: "focus ring on terminal" },
  { fg: "focus", bg: "proof-dim", kind: "nonText", where: "focus ring on attestation" },
  { fg: "proof", bg: "proof-dim", kind: "nonText", where: "attestation eyebrow mark" },
  { fg: "ink", bg: "proof-dim", kind: "nonText", where: "attestation verdict glyph" },
  { fg: "proof", bg: "bg", kind: "nonText", where: "EQUIVALENT dot" },
  { fg: "break", bg: "bg", kind: "nonText", where: "DIVERGED dot" },
  { fg: "open", bg: "bg", kind: "nonText", where: "ABSTAINED dot ring" },
  { fg: "proof", bg: "bg-raised", kind: "nonText", where: "dot on a card" },
  { fg: "break", bg: "bg-raised", kind: "nonText", where: "dot on a card" },
  { fg: "open", bg: "bg-raised", kind: "nonText", where: "dot on a card" },
];

/**
 * Documented exemption. `rule` (1.24:1 in Void) and `rule-strong` (1.76:1) are
 * the system's single hairline: dividers and table rules. WCAG 1.4.11 covers
 * non-text content *required to identify a control or its state*; a divider is
 * not one, and no control in this repo depends on a hairline to be found - every
 * control carries a 4.5:1 label and a 3:1 focus ring. Recorded here rather than
 * silently skipped. See DECISIONS.md D-004.
 */
const BORDER_EXEMPTIONS = ["rule", "rule-strong"];

interface RuntimePair {
  route: string;
  theme: string;
  selector: string;
  sample: string;
  fg: string;
  bg: string;
  fontSize: number;
  fontWeight: number;
  ratio: number;
  required: number;
  ok: boolean;
  isFocusRing?: boolean;
}

interface ContrastEvidence {
  pairs: RuntimePair[];
  textColoursUsed: { theme: string; color: string; selector: string }[];
}

export const gate: Gate = {
  id: "G1",
  title: "Contrast - every text/background pair in both themes",
  run() {
    const failures: string[] = [];
    const notes: string[] = [];

    let checked = 0;
    for (const theme of themeIds) {
      for (const pair of DECLARED_PAIRS) {
        if (pair.themes && !pair.themes.includes(theme)) continue;
        checked++;
        const fg = tokenHex(pair.fg, theme);
        const bg = tokenHex(pair.bg, theme);
        const ratio = round2(contrastHex(fg, bg));
        const required = pair.kind === "body" ? 4.5 : 3;
        if (ratio < required) {
          failures.push(
            `${theme}: ${pair.fg} on ${pair.bg} is ${ratio}:1, needs ${required}:1 (${pair.where})`,
          );
        }
      }
    }
    notes.push(`${checked} declared token pairs checked across both themes`);
    notes.push(
      `hairline exemption recorded for ${BORDER_EXEMPTIONS.join(", ")} (DECISIONS.md D-004)`,
    );

    // proof-press is declared in tokens.json as "never used as a text colour".
    const evidence = readEvidence("contrast.json") as ContrastEvidence | null;
    if (!evidence) {
      failures.push("no .verify/contrast.json - the e2e evidence run did not produce it");
      return fail(failures, notes);
    }

    for (const theme of themeIds) {
      const banned = tokenHex("proof-press", theme).toLowerCase();
      const used = evidence.textColoursUsed.filter(
        (u) => u.theme === theme && u.color.toLowerCase() === banned,
      );
      for (const u of used) {
        failures.push(
          `${theme}: proof-press used as a text colour on ${u.selector} (tokens.json forbids it)`,
        );
      }
    }

    const runtimeFailures = evidence.pairs.filter((p) => !p.ok);
    for (const p of runtimeFailures.slice(0, 20)) {
      failures.push(
        `${p.theme} ${p.route} ${p.selector}: ${round2(p.ratio)}:1 < ${p.required}:1 ` +
          `(${p.fg} on ${p.bg}, ${p.fontSize}px/${p.fontWeight}) "${p.sample.slice(0, 40)}"`,
      );
    }
    if (runtimeFailures.length > 20) {
      failures.push(`...and ${runtimeFailures.length - 20} more runtime pairs`);
    }
    notes.push(`${evidence.pairs.length} rendered text nodes swept across both themes`);

    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
