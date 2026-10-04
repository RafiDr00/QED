import type { CSSProperties } from "react";
import { componentToken } from "@qed/tokens";

import { logoArt, type LogoArt, type LogoShape } from "../generated/logos.js";

/**
 * The logo, drawn from the design system's own SVG files.
 *
 * The caller chooses a size. It cannot choose the mark variant: "shipping one
 * mark for both sizes is the mistake this pair exists to prevent"
 * (assets/Logos/README.md), so the variant is derived here and the wrong one
 * is unreachable from the API. The small file is used at 24px and below, the
 * smoothed one above it - the boundary the design system states twice.
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

function artFor(variant: LogoVariant, sizePx: number): {
  name: string;
  art: LogoArt;
} {
  switch (variant) {
    case "mark": {
      const name = markArtFor(sizePx);
      return { name, art: logoArt[name] };
    }
    case "wordmark":
      return { name: "wordmark", art: logoArt.wordmark };
    case "lockup":
      return { name: "logotype", art: logoArt.logotype };
  }
}

export interface LogoProps {
  variant?: LogoVariant;
  /** Height of the drawing. The mark variant is derived from it. */
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

function Shape({ shape, index }: { shape: LogoShape; index: number }) {
  const fill = `var(--${shape.ink})`;
  if (shape.kind === "path") {
    return (
      <path
        key={index}
        d={shape.d}
        fill={fill}
        {...(shape.fillRule ? { fillRule: shape.fillRule } : {})}
      />
    );
  }
  return (
    <rect
      key={index}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      fill={fill}
    />
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
  const { name, art } = artFor(variant, step.px);
  const style = { "--qed-logo-size": step.token } as CSSProperties;

  return (
    <svg
      className={className ? `qed-logo ${className}` : "qed-logo"}
      viewBox={art.viewBox}
      style={style}
      data-logo={name}
      data-size={size}
      focusable="false"
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": title })}
    >
      {art.shapes.map((shape, index) => (
        <Shape key={index} shape={shape} index={index} />
      ))}
    </svg>
  );
}
