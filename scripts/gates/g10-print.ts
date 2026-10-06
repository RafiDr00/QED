import { round2 } from "../color.ts";
import { fail, pass, readEvidence, type Gate } from "./kit.ts";

// ====================================================================== G10 print

interface GlyphComparison {
  a: string;
  b: string;
  ratio: number;
  dimensionsMatch: boolean;
}

interface PrintEvidence {
  pdf: { file: string; bytes: number };
  glyphs: { state: string; file: string }[];
  pairwiseDifference: GlyphComparison[];
  /** Read back from the page under print media emulation. */
  printed: { ground: string; rows: string[]; buttons: number };
}

/** The Paper ground, which is what a printed page must be on. */
const PAPER_BG = "rgb(250, 249, 246)";

/** Rows the attestation may never drop to save space. */
const REQUIRED_ROWS = ["VERDICT", "INPUTS", "CONTROLS", "TOLERANCES", "ENGINE"];

export const gate: Gate = {
  id: "G10",
  title: "Print - the attestation survives greyscale, glyphs stay distinguishable",
  run() {
    const evidence = readEvidence("print.json") as PrintEvidence | null;
    if (!evidence) return fail(["no .verify/print.json from the e2e run"]);
    const failures: string[] = [];
    const notes: string[] = [];

    if (evidence.pdf.bytes < 2000) {
      failures.push(`the attestation PDF is only ${evidence.pdf.bytes} B - it did not render`);
    } else {
      notes.push(`PDF ${evidence.pdf.bytes} B at ${evidence.pdf.file}`);
    }

    // A byte count alone would pass a blank page, so read the printed card
    // back from the page under print media.
    const printed = evidence.printed;
    if (printed.ground !== PAPER_BG) {
      failures.push(
        `under print media the attestation sits on ${printed.ground}, not the Paper ground ${PAPER_BG} - ` +
          `a reader who used the theme toggle would print the audit page in Void`,
      );
    } else {
      notes.push("print media resolves to Paper even with [data-theme] set");
    }
    for (const row of REQUIRED_ROWS) {
      if (!printed.rows.includes(row)) {
        failures.push(`the printed attestation is missing its ${row} row`);
      }
    }
    if (printed.buttons !== 0) {
      failures.push(
        `${printed.buttons} button(s) survive into print - the filed page has nothing to press`,
      );
    } else {
      notes.push(`${printed.rows.length} field rows printed, no controls`);
    }

    if (evidence.glyphs.length !== 3) {
      failures.push(`expected 3 verdict glyphs in greyscale, found ${evidence.glyphs.length}`);
    }
    for (const pair of evidence.pairwiseDifference) {
      if (!pair.dimensionsMatch) {
        failures.push(
          `${pair.a} and ${pair.b} were rendered at different sizes - the comparison is not a shape comparison`,
        );
        continue;
      }
      if (pair.ratio < 0.08) {
        failures.push(
          `${pair.a} and ${pair.b} differ on only ${round2(pair.ratio * 100)}% of pixels in greyscale - colour is carrying the verdict`,
        );
      } else {
        notes.push(`${pair.a} vs ${pair.b}: ${round2(pair.ratio * 100)}% of pixels differ`);
      }
    }
    if (evidence.pairwiseDifference.length < 3) {
      failures.push("fewer than 3 glyph comparisons recorded");
    }

    // And again at the 9px the chips actually render, which is the size a
    // reader has to tell them apart at.
    const shipped = readEvidence("glyphs-9px.json") as {
      shippedSize: GlyphComparison[];
    } | null;
    if (!shipped) {
      failures.push("no .verify/glyphs-9px.json from the e2e run");
    } else {
      for (const pair of shipped.shippedSize) {
        if (!pair.dimensionsMatch) {
          failures.push(
            `at 9px, ${pair.a} and ${pair.b} were rendered at different sizes`,
          );
          continue;
        }
        if (pair.ratio < 0.08) {
          failures.push(
            `at 9px, ${pair.a} and ${pair.b} differ on only ${round2(pair.ratio * 100)}% of pixels in greyscale`,
          );
        } else {
          notes.push(
            `at 9px: ${pair.a} vs ${pair.b}, ${round2(pair.ratio * 100)}% of pixels differ`,
          );
        }
      }
      if (shipped.shippedSize.length < 3) {
        failures.push("fewer than 3 glyph comparisons at the shipped size");
      }
    }

    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
