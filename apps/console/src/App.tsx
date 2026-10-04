import { useState } from "react";
import {
  Label,
  Logo,
  ThemeToggle,
  verifyRecord,
  type AttestationRecord,
  type VerificationState,
} from "@qed/ui";

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

export function App() {
  const route = useRoute();

  // Verification is real state the shell owns; the card is controlled.
  const [verification, setVerification] = useState<
    Record<string, VerificationState>
  >({});

  /**
   * Really re-derives: recomputes the digest from the record's own signed
   * fields and compares it with the one the record carries. The time reported
   * is the time the check ran, not the record's signing time.
   */
  const verify = (record: AttestationRecord) => {
    const set = (state: VerificationState) => {
      setVerification((current) => ({ ...current, [record.digest]: state }));
    };
    set({ status: "checking" });
    void verifyRecord(record, new Date()).then(set);
  };

  return (
    <>
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
            <span className="con-repo t-mono-sm">acme/ledger</span>
          </span>
          <div className="con-header-actions">
            <Label>BRANCH</Label>
            <span className="t-mono-sm con-branch">
              feat/vat-rounding &rarr; main
            </span>
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
          {route === "run" ? <RunView /> : null}
          {route === "verdicts" ? <VerdictsView /> : null}
          {route === "attestations" ? (
            <AttestationsView verification={verification} onVerify={verify} />
          ) : null}
          {route === "release" ? <ReleaseView /> : null}
          {route === "export" ? <ExportView /> : null}
        </main>
      </div>
    </>
  );
}
