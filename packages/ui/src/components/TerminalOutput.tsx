import {
  bannerSegments,
  buildRunLines,
  runLinesToText,
  type RunLine,
  type Segment,
} from "../model/terminal.js";
import type { RunResult } from "../model/verdict.js";
import { Logo } from "./Logo.js";

/**
 * The CLI output as it appears on a page. It walks the same lines
 * @qed/cli-render turns into ANSI, so the screenshot and the CI log agree
 * character for character.
 *
 * The pane is `bg-sunk` with one hairline at radius-2: the product reads from
 * this surface rather than writing to it.
 */

function Line({ line }: { line: RunLine }) {
  if (line.segments.length === 0) return <>{"\n"}</>;
  return (
    <>
      {line.segments.map((segment: Segment, index) => (
        <span
          key={index}
          className={segment.glyph === true ? "qed-term-glyph" : undefined}
          data-tone={segment.tone}
          data-bold={segment.bold === true ? "true" : undefined}
        >
          {segment.text}
        </span>
      ))}
      {"\n"}
    </>
  );
}

export interface TerminalOutputProps {
  result: RunResult;
  /** The banner appears once per invocation, never per line. */
  banner?: boolean;
  /** Accessible name for the scrollable region. */
  label?: string;
}

export function TerminalOutput({
  result,
  banner = true,
  label = "qed command output",
}: TerminalOutputProps) {
  const lines = buildRunLines(result);
  return (
    <div className="qed-pane">
      {banner ? (
        <p className="qed-pane-banner">
          <Logo variant="mark" size="xs" decorative />
          <span className="t-label">QED &middot; DETERMINISTIC VERIFICATION</span>
        </p>
      ) : null}
      <div
        className="qed-pane-scroll"
        tabIndex={0}
        role="group"
        aria-label={label}
      >
        <pre className="qed-term t-mono">
          <code>
            {lines.map((line, index) => (
              <Line key={index} line={line} />
            ))}
          </code>
        </pre>
      </div>
    </div>
  );
}

/** The same output as plain text - for a copy button or a test. */
export function terminalText(result: RunResult): string {
  return runLinesToText(buildRunLines(result));
}

export { bannerSegments };
