import {
  Attestation,
  type AttestationRecord,
  type VerificationState,
} from "@qed/ui";

import { ATTESTATION, ATTESTATION_STRICT } from "../fixtures.js";

export interface AttestationsViewProps {
  verification: Record<string, VerificationState>;
  onVerify: (record: AttestationRecord) => void;
}

/**
 * The signed records. Verification is a real action: the button recomputes the
 * record's digest from its own signed fields and compares it with the one the
 * record carries, then the card reports what came back.
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
            onVerify(record);
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
