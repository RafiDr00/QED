import { Attestation, Button, Card, Label, Table } from "@qed/ui";

import { ATTESTATION, EXPORT_CONTENTS, type ExportRow } from "../fixtures.js";

/**
 * The audit bundle, before it is downloaded. The preview renders in Paper -
 * the theme that exists for print, PDFs and this bundle - inside the Void
 * shell, which is what the nested [data-theme] attribute is for.
 */
export function ExportView() {
  return (
    <div className="qed-stack" data-gap="section">
      <section aria-labelledby="export-contents">
        <div className="qed-section-heading">
          <h2 id="export-contents" className="t-heading">
            Bundle contents
          </h2>
        </div>
        <div className="qed-table-scroll" tabIndex={0} role="group" aria-label="Bundle contents">
          <Table<ExportRow>
            caption="Files in the audit export"
            rows={EXPORT_CONTENTS}
            rowKey={(row) => row.file}
            empty="Nothing to export from this release."
            columns={[
              { key: "file", header: "FILE", rowHeader: true, cell: (row) => <span className="t-mono">{row.file}</span> },
              { key: "kind", header: "CONTENTS", cell: (row) => <span className="t-body-sm con-sub">{row.kind}</span> },
              { key: "size", header: "SIZE", align: "end", cell: (row) => <span className="t-mono-sm">{row.size}</span> },
              { key: "digest", header: "DIGEST", align: "end", cell: (row) => <span className="t-mono-sm">{row.digest}</span> },
            ]}
          />
        </div>
        <div className="con-export-actions">
          <Button variant="primary">Download bundle</Button>
          <Button>Copy manifest digest</Button>
        </div>
      </section>

      <section aria-labelledby="export-preview">
        <div className="qed-section-heading">
          <h2 id="export-preview" className="t-heading">
            Filed page
          </h2>
        </div>
        <p className="t-body-sm qed-prose con-note">
          This is the page an assessor receives: the same geometry and the same
          type as the card on screen, on Paper.
        </p>
        <Card as="div">
          <p className="con-preview-label">
            <Label>PAPER PREVIEW</Label>
          </p>
          <div data-theme="paper" className="con-paper">
            <Attestation record={ATTESTATION} />
          </div>
        </Card>
      </section>
    </div>
  );
}
