import { Attestation, type VerificationState } from "@qed/ui";

import { ATTESTATION, ATTESTATION_STRICT } from "../fixtures.js";

export interface AttestationsViewProps {
  verification: Record<string, VerificationState>;
  onVerify: (digest: string) => void;
}

/**
 * The signed records. Verification is a real action: the button re-derives the
 * verdict from the record and the card reports what came back. The timestamp
 * is part of the record rather than read from a clock, so a re-run of the
 * screenshot produces the same pixels.
 */
export function AttestationsView({
  verification,
  onVerify,
}: AttestationsViewProps) {
  return (
    <div className="qed-stack" data-gap="card">
      {[ATTESTATION, ATTESTATION_STRICT].map((record) => (
        <Attestation
          key={record.digest}
          record={record}
          verification={verification[record.digest] ?? { status: "idle" }}
          onVerify={() => {
            onVerify(record.digest);
          }}
        />
      ))}
      <p className="t-body-sm qed-prose con-note">
        The second record applied no tolerance. The row prints anyway: dropping
        it to save space is the difference between evidence and a badge.
      </p>
    </div>
  );
}
