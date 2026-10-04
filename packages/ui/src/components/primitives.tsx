import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Button, Card, Label and FocusRing - the four pieces every surface is built
 * from. Real elements only: a button is a <button>, a heading is a heading.
 */

export type ButtonVariant = "primary" | "secondary" | "quiet";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> {
  variant?: ButtonVariant;
  children: ReactNode;
}

/**
 * The primary button is `proof` - the brand colour, the success colour and the
 * primary action are deliberately one colour (brand book, section 2).
 *
 * `proof-dim` is *not* used for hover, though tokens.json offers it: it is
 * 3.4:1 behind a button label in Void and 1.3:1 in Paper. Hover and press both
 * go to `proof-press`, and the pressed state adds an inset rim instead of a
 * shadow. DECISIONS.md D-003.
 */
export function Button({
  variant = "secondary",
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className="qed-button" data-variant={variant} type={type} {...rest}>
      {children}
    </button>
  );
}

export interface CardProps {
  children: ReactNode;
  /** Renders as <section> with an accessible name when a heading id is given. */
  labelledBy?: string;
  as?: "div" | "section" | "article" | "li";
}

/** One step off the ground, never more: `bg-raised`, one hairline, radius-2. */
export function Card({ children, labelledBy, as: Tag = "div" }: CardProps) {
  return (
    <Tag className="qed-card" {...(labelledBy ? { "aria-labelledby": labelledBy } : {})}>
      {children}
    </Tag>
  );
}

export interface LabelProps {
  children: string;
  /** Pair with the element it labels. */
  id?: string;
  tone?: "muted" | "ink" | "proof";
}

/**
 * The system's only uppercase style. The capitals are set in the markup, never
 * with text-transform (tokens.json, `label`), so the DOM text is what a screen
 * reader and a copy-paste both get.
 */
export function Label({ children, id, tone = "muted" }: LabelProps) {
  if (process.env["NODE_ENV"] !== "production" && /[a-z]/.test(children)) {
    // eslint-disable-next-line no-console
    console.warn(
      `<Label> expects capitals in the markup, not text-transform: received "${children}"`,
    );
  }
  return (
    <span className="qed-label t-label" data-tone={tone} {...(id ? { id } : {})}>
      {children}
    </span>
  );
}

export interface FocusRingProps {
  children: ReactNode;
  /** Render the ring around a group that contains the real control. */
  as?: "div" | "span" | "li" | "tr";
}

/**
 * Puts the one focus treatment - 2px `focus` at 2px offset - around a
 * composite that owns a control, so the ring is visible even when the focused
 * element is a bare link inside a row.
 */
export function FocusRing({ children, as: Tag = "span" }: FocusRingProps) {
  return <Tag className="qed-focus-ring">{children}</Tag>;
}
