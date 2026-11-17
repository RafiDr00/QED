import { useEffect, useRef, useState } from "react";
import {
  Button,
  Label,
  Logo,
  ThemeToggle,
  signedRunFor,
  verifyRecord,
  UNSIGNED,
  type AttestationRecord,
  type VerificationState,
} from "@qed/ui";

import { BundleContext, latestRun, useBundleState, type Loaded } from "./bundle.js";
import { ROUTES, titleOf, useRoute } from "./router.js";
import { AttestationsView } from "./views/AttestationsView.js";
import { ExportView } from "./views/ExportView.js";
import { ReleaseView } from "./views/ReleaseView.js";
import { RunView } from "./views/RunView.js";
import { VerdictsView } from "./views/VerdictsView.js";

/**
 * The product shell. One <nav>, one <main>, a skip link, and a heading per
 * view - the keyboard walkthrough test depends on exactly that order.
 */

/**
 * Verification, as far as a browser can take it.
 *
 * The digest is re-derived from the record's own fields. Then the signature
 * claim: an unsigned record says so; a signed one must be listed, exactly as
 * it reads, by a signed run in the bundle. The certificate chain and Rekor's
 * inclusion proof need `qed verify`, and the result says that rather than
 * implying it checked them.
 */
async function verifyInBrowser(record: AttestationRecord, loaded: Loaded): Promise<VerificationState> {
  const digest = await verifyRecord(record, new Date());
  if (digest.status !== "verified") return digest;

  if (record.signer === UNSIGNED) {
    return { ...digest, detail: "Unsigned: nothing in it says who ran it." };
  }
  const signed = await signedRunFor(record, loaded.bundle.signatures);
  if (!signed) {
    return {
      status: "mismatch",
      detail:
        "The digest re-derives, but no signed run in this bundle lists the record as it reads. Do not rely on it.",
    };
  }
  return {
    ...digest,
    detail:
      `A signed run lists it, signed by ${record.signer} and logged at Rekor index ${record.rekorIndex}. ` +
      "qed verify checks that certificate and the log's inclusion proof; a browser cannot.",
  };
}

export function App() {
  const route = useRoute();
  const state = useBundleState();
  const { loaded, refusal, open, reset } = state;
  const picker = useRef<HTMLInputElement>(null);

  // Verification is real state the shell owns; the card is controlled. It
  // belongs to one bundle: opening another starts every card from idle.
  const [verification, setVerification] = useState<{
    readonly text: string;
    readonly states: Record<string, VerificationState>;
  }>({ text: loaded.text, states: {} });
  const states = verification.text === loaded.text ? verification.states : {};

  const verify = (record: AttestationRecord) => {
    const forText = loaded.text;
    const set = (next: VerificationState) => {
      setVerification((current) => ({
        text: forText,
        states: { ...(current.text === forText ? current.states : {}), [record.digest]: next },
      }));
    };
    set({ status: "checking" });
    void verifyInBrowser(record, loaded).then(set);
  };

  // A bundle dropped anywhere on the page is opened.
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      event.preventDefault();
      void open(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [open]);

  const run = latestRun(loaded);
  const signedCount = loaded.bundle.records.filter((r) => r.signer !== UNSIGNED).length;

  return (
    <BundleContext.Provider value={state}>
      <a className="qed-skip-link" href="#main">
        Skip to content
      </a>

      <header className="con-header">
        <div className="con-header-inner">
          <span className="con-brand">
            {/*
              The wordmark is drawn, never set in a font: "Never re-set the
              wordmark in a font" (components/Logotype/README.md).
            */}
            <Logo variant="lockup" size="sm" title="QED" />
            <span className="con-repo t-mono-sm">{loaded.bundle.repository}</span>
          </span>
          <div className="con-header-actions">
            <Label>BUNDLE</Label>
            <span className="t-mono-sm con-branch" data-testid="bundle-source">
              {loaded.source} &middot; {loaded.bundle.records.length} records &middot;{" "}
              {signedCount} signed
            </span>
            <input
              ref={picker}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Audit bundle file"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void open(file);
                event.currentTarget.value = "";
              }}
            />
            <Button onClick={() => picker.current?.click()}>Open bundle</Button>
            {loaded.example ? null : <Button onClick={reset}>Back to the example</Button>}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="con-body">
        <nav className="con-nav" aria-label="Console">
          <ul>
            {ROUTES.map((item) => (
              <li key={item.id}>
                <a
                  className="con-nav-link t-body-sm"
                  href={item.hash}
                  {...(route === item.id ? { "aria-current": "page" } : {})}
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="con-main" tabIndex={-1}>
          <h1 className="t-display-sm con-title">{titleOf(route)}</h1>
          {refusal === undefined ? null : (
            <p className="t-body-sm qed-prose con-refusal" role="alert">
              {refusal}
            </p>
          )}
          {route === "run" ? <RunView run={run} /> : null}
          {route === "verdicts" ? <VerdictsView run={run} /> : null}
          {route === "attestations" ? (
            <AttestationsView run={run} verification={states} onVerify={verify} />
          ) : null}
          {route === "release" ? <ReleaseView loaded={loaded} /> : null}
          {route === "export" ? <ExportView loaded={loaded} /> : null}
        </main>
      </div>
    </BundleContext.Provider>
  );
}
