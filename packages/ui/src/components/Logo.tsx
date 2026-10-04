import type { CSSProperties } from "react";
import { componentToken } from "@qed/tokens";

import { logoArt, type LogoArt, type LogoShape } from "../generated/logos.js";

/**
 * The logo, drawn from the design system's own SVG files.
 *
 * The caller chooses a size. It never chooses the mark variant: "shipping one
 * mark for both sizes is the mistake this pair exists to prevent"
 * (assets/Logos/README.md). The small file is used at 24px and below, the
 * smoothed one above it - the boundary the design system states twice.
 *
 * That holds for the lockup too. `qed-logotype.svg` bakes in the smoothed
 * mark, and the mark inside a lockup is 0.42x the lockup's height, so shipping
 * that file would draw the smoothed geometry at 10px in a 24px header - the one
 * thing the Logotype README's "Never" list forbids. The lockup is therefore
 * composed here, from the wordmark plus whichever mark is right at the size it
 * will actually be drawn, positioned by the README's own lockup rule.
 */

export const LOGO_SIZES = {
  xs: { token: componentToken.logoXs, px: 16 },
  sm: { token: componentToken.logoSm, px: 24 },
  md: { token: componentToken.logoMd, px: 32 },
  lg: { token: componentToken.logoLg, px: 48 },
  xl: { token: componentToken.logoXl, px: 96 },
} as const;

export type LogoSize = keyof typeof LOGO_SIZES;

/** What to draw. Never which file to draw it from. */
export type LogoVariant = "mark" | "wordmark" | "lockup";

/** The boundary stated in assets/Logos/README.md and Logotype/README.md. */
const SMALL_MARK_MAX_PX = 24;

export type MarkArtName = "mark" | "mark-16";

export function markArtFor(sizePx: number): MarkArtName {
  return sizePx <= SMALL_MARK_MAX_PX ? "mark-16" : "mark";
}

/**
 * Both mark files are drawn inside a 24-unit box with the shape inset by 2
 * units of clear space. `size` means the mark, not the padding around it, so
 * the viewBox is tightened to the shape. Clear space is the layout's job.
 */
const MARK_VIEWBOX = "2 2 20 20";
const MARK_ART_SIDE = 20;

/**
 * The lockup geometry, from components/Logotype/README.md: "Mark trailing the
 * wordmark, bottom-aligned to the baseline, at 0.78x the x-height, gap 30
 * units." x-height is 72, so the mark is 56.16 units; the wordmark's last stem
 * ends at x 251.2, so the mark starts at 281.2; the baseline is y 72.
 */
const LOCKUP = {
  xHeight: 72,
  markScale: 0.78,
  // In the drawing's own user units, not CSS pixels.
  gapUnits: 30,
  wordmarkRight: 251.2,
  baseline: 72,
} as const;

const LOCKUP_MARK_SIDE = LOCKUP.xHeight * LOCKUP.markScale;
const LOCKUP_MARK_X = LOCKUP.wordmarkRight + LOCKUP.gapUnits;
const LOCKUP_MARK_Y = LOCKUP.baseline - LOCKUP_MARK_SIDE;

/** The wordmark box is 132 units tall; the mark inside it is 56.16 of those. */
const LOCKUP_MARK_RATIO = LOCKUP_MARK_SIDE / 132;

export interface LogoProps {
  variant?: LogoVariant;
  /**
   * Height of the drawing. For the mark that is the mark itself; for the
   * wordmark and the lockup it is the full box, clear space included.
   */
  size?: LogoSize;
  /**
   * Hide it from assistive technology. Use when a visible wordmark sits
   * beside it, or inside a labelled banner that already says "QED".
   */
  decorative?: boolean;
  /** Accessible name when it is not decorative. */
  title?: string;
  className?: string;
}

function Shape({ shape }: { shape: LogoShape }) {
  const fill = `var(--${shape.ink})`;
  if (shape.kind === "path") {
    return (
      <path
        d={shape.d}
        fill={fill}
        {...(shape.fillRule ? { fillRule: shape.fillRule } : {})}
      />
    );
  }
  return (
    <rect
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      fill={fill}
    />
  );
}

function Shapes({ art }: { art: LogoArt }) {
  return (
    <>
      {art.shapes.map((shape, index) => (
        <Shape key={index} shape={shape} />
      ))}
    </>
  );
}

export function Logo({
  variant = "lockup",
  size = "md",
  decorative = false,
  title = "QED",
  className,
}: LogoProps) {
  const step = LOGO_SIZES[size];
  const style = { "--qed-logo-size": step.token } as CSSProperties;

  const naming = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": title } as const);

  const common = {
    className: className ? `qed-logo ${className}` : "qed-logo",
    style,
    focusable: "false" as const,
    "data-size": size,
    ...naming,
  };

  if (variant === "mark") {
    const name = markArtFor(step.px);
    return (
      <svg {...common} viewBox={MARK_VIEWBOX} data-logo={name}>
        <Shapes art={logoArt[name]} />
      </svg>
    );
  }

  if (variant === "wordmark") {
    return (
      <svg {...common} viewBox={logoArt.wordmark.viewBox} data-logo="wordmark">
        <Shapes art={logoArt.wordmark} />
      </svg>
    );
  }

  // The lockup: the wordmark, plus the mark the drawn size calls for.
  const markPx = step.px * LOCKUP_MARK_RATIO;
  const markName = markArtFor(markPx);
  const scale = LOCKUP_MARK_SIDE / MARK_ART_SIDE;

  return (
    <svg
      {...common}
      viewBox={logoArt.logotype.viewBox}
      data-logo="lockup"
      data-lockup-mark={markName}
    >
      <Shapes art={logoArt.wordmark} />
      <g
        data-mark-in-lockup={markName}
        transform={`translate(${LOCKUP_MARK_X} ${LOCKUP_MARK_Y}) scale(${scale}) translate(-2 -2)`}
      >
        <Shapes art={logoArt[markName]} />
      </g>
    </svg>
  );
}
