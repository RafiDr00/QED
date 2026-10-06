import { round2 } from "../color.ts";
import { fail, pass, readEvidence, type Gate } from "./kit.ts";

// ============================================================== G5 mark optics

interface MarkEvidence {
  renders: {
    size: number;
    variant: string;
    cutEdgeFraction: number;
    cutSideFraction: number;
    cornerIsSquare: boolean;
    cornerRadiusFraction: number;
    cutAngleDegrees: number;
    bottomLeftIsInk: boolean;
    topRightIsInk: boolean;
    inkFraction: number;
  }[];
}

/**
 * What each file is, from the design system's own table:
 *   qed-mark.svg     corners 5.5% of the side, cut 46%, 32px and up
 *   qed-mark-16.svg  corners square,            cut 52%, 24px and below
 *
 * Checking the cut as a fraction of the side, and whether the corner is
 * square, is what actually tells the two files apart. Checking only that
 * "something is cut" passes either file, and would pass a mark with a 20% cut.
 */
const MARK_SPEC = {
  mark: { cut: 0.46, cornerIsSquare: false, radius: 0.055 },
  "mark-16": { cut: 0.52, cornerIsSquare: true, radius: 0 },
} as const;

/** Rasterising a 16px mark at 4x leaves about this much slack. */
const CUT_TOLERANCE = 0.04;

export const gate: Gate = {
  id: "G5",
  title: "Mark optics - the right variant at each size, and the cut still reads",
  run() {
    const evidence = readEvidence("mark-optics.json") as MarkEvidence | null;
    if (!evidence) return fail(["no .verify/mark-optics.json from the e2e run"]);
    const failures: string[] = [];
    const notes: string[] = [];

    const expectedSizes = [16, 24, 32, 48];
    for (const size of expectedSizes) {
      const render = evidence.renders.find((r) => r.size === size);
      if (!render) {
        failures.push(`no render recorded at ${size}px`);
        continue;
      }
      // The design system: qed-mark-16 at 24px and below, qed-mark above it.
      const expected = size <= 24 ? "mark-16" : "mark";
      if (render.variant !== expected) {
        failures.push(
          `${size}px rendered the '${render.variant}' variant, expected '${expected}'`,
        );
      }
      if (render.cutEdgeFraction < 0.4) {
        failures.push(
          `${size}px: the cut covers ${round2(render.cutEdgeFraction * 100)}% of the bottom-right quadrant edge, needs 40%`,
        );
      }

      const spec = MARK_SPEC[expected];
      const drift = Math.abs(render.cutSideFraction - spec.cut);
      if (drift > CUT_TOLERANCE) {
        failures.push(
          `${size}px: the cut is ${round2(render.cutSideFraction * 100)}% of the side, and '${expected}' is drawn at ${round2(spec.cut * 100)}%`,
        );
      }
      // A squircle's ink reaches the top edge sooner than its nominal radius,
      // so the measured inset is a fraction of it - but a 15% corner would
      // still be nowhere near a 5.5% one.
      const radiusDrift = Math.abs(render.cornerRadiusFraction - spec.radius);
      if (radiusDrift > 0.05) {
        failures.push(
          `${size}px: the corner rounds at ${round2(render.cornerRadiusFraction * 100)}% of the side, and '${expected}' rounds at ${round2(spec.radius * 100)}%`,
        );
      }
      // "The cut stays razor-sharp against them" - and at 45 degrees, the
      // same angle as the wordmark's `e` aperture. One geometric idea, twice.
      if (Math.abs(render.cutAngleDegrees - 45) > 4) {
        failures.push(
          `${size}px: the cut runs at ${round2(render.cutAngleDegrees)} degrees, and the system cuts at 45`,
        );
      }

      // The cut is in the bottom-right corner. Both other corners stay solid,
      // which is what a mirrored or rotated mark would break while keeping
      // every path byte identical.
      if (!render.bottomLeftIsInk) {
        failures.push(
          `${size}px: the bottom-left corner is cut away - the mark is mirrored or rotated`,
        );
      }
      if (!render.topRightIsInk) {
        failures.push(
          `${size}px: the top-right corner is cut away - the mark is rotated`,
        );
      }

      if (render.cornerIsSquare !== spec.cornerIsSquare) {
        failures.push(
          `${size}px: corner is ${render.cornerIsSquare ? "square" : "smoothed"}, and '${expected}' has ${spec.cornerIsSquare ? "square" : "smoothed"} corners`,
        );
      }

      notes.push(
        `${size}px ${render.variant}: cut ${round2(render.cutSideFraction * 100)}% of the side ` +
          `(${render.cornerIsSquare ? "square" : "smoothed"} corners, radius ${round2(render.cornerRadiusFraction * 100)}%, cut at ${round2(render.cutAngleDegrees)} deg), ` +
          `${round2(render.cutEdgeFraction * 100)}% of the quadrant edge, ink ${round2(render.inkFraction * 100)}%`,
      );
    }
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
