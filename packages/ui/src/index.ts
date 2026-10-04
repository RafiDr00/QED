/**
 * @qed/ui - the QED component library.
 *
 * Pair the stylesheet with the tokens, tokens first:
 *   import "@qed/tokens/tokens.css";
 *   import "@qed/ui/ui.css";
 */
export * from "./model/index.js";

export { Logo, LOGO_SIZES, markArtFor } from "./components/Logo.js";
export type {
  LogoProps,
  LogoSize,
  LogoVariant,
  MarkArtName,
} from "./components/Logo.js";

export { Button, Card, Label, FocusRing } from "./components/primitives.js";
export type {
  ButtonProps,
  ButtonVariant,
  CardProps,
  FocusRingProps,
  LabelProps,
} from "./components/primitives.js";

export { Table } from "./components/Table.js";
export type { Column, TableProps } from "./components/Table.js";

export {
  VerdictChip,
  VerdictDot,
  VerdictEvidence,
  VerdictTable,
} from "./components/verdict.js";
export type {
  VerdictChipProps,
  VerdictDotProps,
  VerdictTableProps,
} from "./components/verdict.js";

export { Attestation } from "./components/Attestation.js";
export type { AttestationProps } from "./components/Attestation.js";

export { TerminalOutput, terminalText } from "./components/TerminalOutput.js";
export type { TerminalOutputProps } from "./components/TerminalOutput.js";
