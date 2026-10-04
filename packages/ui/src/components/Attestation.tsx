import type { ReactNode } from "react";

import type {
  AttestationRecord,
  VerificationState,
} from "../model/attestation.js";
import { evidenceLine, formatCount } from "../model/verdict.js";
import { Logo } from "./Logo.js";
import { Button, Label } from "./primitives.js";
import { VerdictDot } from "./verdict.js";

/**
 * The signature component: the signed record of one verification, identical on
 * screen and in the filed PDF.
 *
 * Two deliberate departures from the preview, both forced by contrast on the
 * `proof-dim` ground, both recorded in DECISIONS.md:
 *   D-002  every line inside the card is `ink`. `ink-muted` is 1.7:1 on Void's
 *          proof-dim and `proof` is 3.1:1 - neither can carry a sentence.
 *          Hierarchy comes from the type styles instead, which is what the
 *          brand book asks for anyway ("Hierarchy comes from weight and size").
 *   D-002  the verdict inside the card renders in `ink` too. The README
 *          forbids `proof` here, and `break`/`open` fail on this ground in both
 *          themes, so the glyph carries the state - which is the rule the
 *          system states first.
 */

export interface AttestationProps {
  record: AttestationRecord;
  verification?: VerificationState;
  onVerify?: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="qed-field">
      <dt>
        <Label tone="ink">{label}</Label>
      </dt>
      <dd className="t-mono">{children}</dd>
    </div>
  );
}

function inputsLine(record: AttestationRecord): string {
  const { verdict } = record;
  if (verdict.state === "EQUIVALENT") {
    return `${formatCount(verdict.inputs)} — ${record.inputStrategy}`;
  }
  if (verdict.state === "DIVERGED") {
    const found = verdict.counterexample.foundAt;
    return found
      ? `${formatCount(found.of)} — ${record.inputStrategy}`
      : record.inputStrategy;
  }
  return `none — ${record.inputStrategy}`;
}

function VerificationStatus({ state }: { state: VerificationState }) {
  const text =
    state.status === "idle"
      ? ""
      : state.status === "checking"
        ? "Re-deriving the verdict from the record…"
        : state.status === "verified"
          ? `Re-derived and matched at ${state.checkedAt}.`
          : state.detail;
  return (
    <p className="qed-verify-status t-body-sm" role="status" data-status={state.status}>
      {text}
    </p>
  );
}

export function Attestation({
  record,
  verification = { status: "idle" },
  onVerify,
}: AttestationProps) {
  const titleId = `attestation-${record.commit}-${record.symbol}`;
  const checking = verification.status === "checking";

  return (
    <article
      className="qed-attestation"
      data-verification={verification.status}
      aria-labelledby={titleId}
    >
      <p className="qed-attestation-eyebrow">
        <Logo variant="mark" size="xs" decorative />
        <Label tone="ink">SIGNED ATTESTATION</Label>
      </p>

      <h2 id={titleId} className="qed-attestation-title t-display-sm">
        {record.symbol}
      </h2>
      <p className="qed-attestation-subject t-mono-sm">
        {record.path} &middot; {record.repository} @ {record.commit} &middot;{" "}
        {record.timestamp}
      </p>

      <dl className="qed-fields">
        <Field label="VERDICT">
          <span className="qed-attestation-verdict">
            <VerdictDot state={record.verdict.state} />
            <span className="t-verdict">{record.verdict.state}</span>
            <span className="qed-attestation-evidence">
              {evidenceLine(record.verdict)}
            </span>
          </span>
        </Field>
        <Field label="INPUTS">{inputsLine(record)}</Field>
        <Field label="CONTROLS">
          {record.controls.length > 0
            ? record.controls.join(" · ")
            : "none recorded"}
        </Field>
        <Field label="TOLERANCES">
          {record.tolerances.length > 0
            ? `${record.tolerances.join(" · ")} — applied, and recorded`
            : "none applied"}
        </Field>
        <Field label="ENGINE">
          {record.engine} &middot; signer: {record.signer}
        </Field>
      </dl>

      <div className="qed-attestation-foot">
        <p className="qed-digest t-mono-sm">
          rekor #{record.rekorIndex} &middot; {record.digest}
        </p>
        {onVerify ? (
          <Button
            variant="primary"
            onClick={checking ? undefined : onVerify}
            aria-busy={checking}
            aria-describedby={`${titleId}-status`}
          >
            {checking ? "Verifying…" : "Verify independently"}
          </Button>
        ) : null}
      </div>
      <div id={`${titleId}-status`}>
        <VerificationStatus state={verification} />
      </div>
    </article>
  );
}
