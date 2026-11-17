import { useEffect, useState } from "react";
import { Attestation, Button, Card, Label, Table, UNSIGNED, sha256Of } from "@qed/ui";

import type { Loaded } from "../bundle.js";

/**
 * The audit bundle, before it is handed over.
 *
 * Everything here is the bundle the console has open: its parts counted from
 * what it holds, its digest computed from its bytes, and the download is
 * those same bytes. The preview renders in Paper - the theme that exists for
 * print, PDFs and this bundle - inside the Void shell, which is what the
 * nested [data-theme] attribute is for.
 */

interface Part {
  readonly part: string;
  readonly holds: string;
  readonly count: number;
}

function partsOf(loaded: Loaded): Part[] {
  const { bundle } = loaded;
  const count = (state: string) => bundle.records.filter((r) => r.verdict.state === state).length;
  return [
    { part: "Records", holds: "One per function a run looked at, under its digest", count: bundle.records.length },
    { part: "Counterexamples", holds: "Every minimised input that diverged, with its repro line", count: count("DIVERGED") },
    { part: "Abstentions", holds: "Every function not run, and the exact reason", count: count("ABSTAINED") },
    { part: "Run summaries", holds: "How each run was invoked, and how long it took", count: bundle.runs.length },
    {
      part: "Signatures",
      holds: "Sigstore bundles: certificate, signature and Rekor inclusion proof",
      count: bundle.signatures.length,
    },
    { part: "Unsigned records", holds: "Records no signature covers, which say so", count: bundle.records.filter((r) => r.signer === UNSIGNED).length },
  ];
}

/** "qed-bundle.json", or the name the reader opened it under. */
const fileName = (loaded: Loaded) => (loaded.example ? "qed-bundle.json" : loaded.source);

export function ExportView({ loaded }: { loaded: Loaded }) {
  const [digest, setDigest] = useState<{ readonly text: string; readonly value: string } | undefined>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    let current = true;
    void sha256Of(loaded.text).then((value) => {
      if (current) setDigest({ text: loaded.text, value });
    });
    return () => {
      current = false;
    };
  }, [loaded.text]);

  const shown = digest?.text === loaded.text ? digest.value : undefined;
  const bytes = new TextEncoder().encode(loaded.text).byteLength;
  const preview = loaded.runs[0]?.records[0];

  const download = () => {
    const url = URL.createObjectURL(new Blob([loaded.text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(loaded);
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`Saved ${fileName(loaded)}, ${bytes.toLocaleString("en-US")} bytes.`);
  };

  const copy = () => {
    if (shown === undefined) return;
    navigator.clipboard.writeText(shown).then(
      () => {
        setStatus(`Copied ${shown}.`);
      },
      () => {
        setStatus("The browser refused the clipboard. The digest is printed above; copy it from there.");
      },
    );
  };

  return (
    <div className="qed-stack" data-gap="section">
      <section aria-labelledby="export-contents">
        <div className="qed-section-heading">
          <h2 id="export-contents" className="t-heading">
            Bundle contents
          </h2>
        </div>
        <p className="t-body-sm qed-prose con-note">
          One file, {bytes.toLocaleString("en-US")} bytes, as qed export writes it and as an
          assessor receives it. It opens in this console with no network.
        </p>
        <p className="t-mono-sm con-digest" data-testid="bundle-digest">
          {shown ?? "computing the digest…"}
        </p>
        <div className="qed-table-scroll" tabIndex={0} role="group" aria-label="Bundle contents">
          <Table<Part>
            caption={`What ${fileName(loaded)} holds`}
            rows={partsOf(loaded)}
            rowKey={(row) => row.part}
            empty="Nothing in this bundle."
            columns={[
              { key: "part", header: "PART", rowHeader: true, cell: (row) => <span className="t-mono">{row.part}</span> },
              { key: "holds", header: "HOLDS", cell: (row) => <span className="t-body-sm con-sub">{row.holds}</span> },
              { key: "count", header: "COUNT", align: "end", cell: (row) => <span className="t-mono-sm">{row.count}</span> },
            ]}
          />
        </div>
        <div className="con-export-actions">
          <Button variant="primary" onClick={download}>
            Download bundle
          </Button>
          <Button onClick={copy}>Copy bundle digest</Button>
        </div>
        <p className="t-body-sm con-note" role="status" data-testid="export-status">
          {status}
        </p>
      </section>

      {preview ? (
        <section aria-labelledby="export-preview">
          <div className="qed-section-heading">
            <h2 id="export-preview" className="t-heading">
              Filed page
            </h2>
          </div>
          <p className="t-body-sm qed-prose con-note">
            This is the page an assessor receives for each record: the same
            geometry and the same type as the card on screen, on Paper.
          </p>
          <Card as="div">
            <p className="con-preview-label">
              <Label>PAPER PREVIEW</Label>
            </p>
            <div data-theme="paper" className="con-paper">
              <Attestation record={preview} />
            </div>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
