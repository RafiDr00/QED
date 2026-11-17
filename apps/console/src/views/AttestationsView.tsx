import {
  Attestation,
  UNSIGNED,
  type AttestationRecord,
  type BundleRun,
  type VerificationState,
} from "@qed/ui";

export interface AttestationsViewProps {
  run: BundleRun;
  verification: Record<string, VerificationState>;
  onVerify: (record: AttestationRecord) => void;
}

/**
 * The newest run's records. Verification is a real action: the button
 * recomputes each record's digest from its own fields and checks which signed
 * run, if any, lists it. The card reports what came back.
 */
export function AttestationsView({ run, verification, onVerify }: AttestationsViewProps) {
  const unsigned = run.records.filter((r) => r.signer === UNSIGNED).length;

  return (
    <div className="qed-stack" data-gap="card">
      <p className="t-body-sm qed-prose con-note">
        {run.records.length} {run.records.length === 1 ? "record" : "records"} from{" "}
        {run.repository} @ {run.commit}.{" "}
        {unsigned === 0
          ? "Every one names the identity that signed its run."
          : unsigned === run.records.length
            ? "None is signed: the run was made without qed check --sign, and each card says so."
            : `${unsigned} are unsigned, and say so.`}
      </p>
      {run.records.map((record) => (
        <Attestation
          key={record.digest}
          record={record}
          verification={verification[record.digest] ?? { status: "idle" }}
          onVerify={() => {
            onVerify(record);
          }}
        />
      ))}
    </div>
  );
}
