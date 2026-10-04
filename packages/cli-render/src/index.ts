import { rawColor } from "@qed/tokens";
import {
  bannerSegments,
  buildRunLines,
  summarise,
  type RunResult,
  type Segment,
  type Tone,
} from "@qed/ui/model";

/**
 * @qed/cli-render - a run result in, an ANSI string out. No I/O, no clock, no
 * environment sniffing: the same input gives the same bytes, which is the one
 * property a tool that claims determinism has to hold itself to.
 *
 * It walks the same lines as the terminal pane on screen (@qed/ui/model), so
 * the CI log and the screenshot cannot drift. Only the painting differs.
 */

export type { RunResult } from "@qed/ui/model";

const RESET = "\u001b[0m";
const BOLD = "\u001b[1m";

const TONE_TOKEN: Readonly<Record<Tone, string>> = {
  ink: "ink",
  muted: "ink-muted",
  proof: "proof",
  break: "break",
  open: "open",
};

export type ThemeId = "void" | "paper";

export interface RenderOptions {
  /**
   * Paint with 24-bit colour. Off gives the same columns and the same glyphs
   * in plain text - the output is designed to survive a pipe, a ticket paste
   * and a printer.
   */
  readonly color?: boolean;
  /** Which theme's palette to paint with. The terminal is dark by default. */
  readonly theme?: ThemeId;
  /** Print the banner. Once per invocation, never per line. */
  readonly banner?: boolean;
}

function ansiFor(token: string, theme: ThemeId): string {
  const entry = rawColor[token];
  const hex = entry?.[theme];
  if (hex === undefined) throw new Error(`no colour token '${token}'`);
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `\u001b[38;2;${r};${g};${b}m`;
}

function paint(
  segment: Segment,
  color: boolean,
  theme: ThemeId,
): string {
  if (!color) return segment.text;
  if (segment.text.trim() === "") return segment.text;
  const prefix = `${segment.bold === true ? BOLD : ""}${ansiFor(TONE_TOKEN[segment.tone], theme)}`;
  return `${prefix}${segment.text}${RESET}`;
}

export function renderRun(
  result: RunResult,
  options: RenderOptions = {},
): string {
  const { color = true, theme = "void", banner = true } = options;
  const out: string[] = [];

  if (banner) {
    out.push(
      bannerSegments()
        .map((segment) => paint(segment, color, theme))
        .join(""),
    );
    out.push("");
  }

  for (const line of buildRunLines(result)) {
    out.push(
      line.segments.map((segment) => paint(segment, color, theme)).join(""),
    );
  }

  return `${out.join("\n").replace(/[ \t]+$/gm, "")}\n`;
}

/** Non-zero only on DIVERGED. Abstaining is not a failure. */
export function exitCodeFor(result: RunResult): number {
  return summarise(result).exitCode;
}
