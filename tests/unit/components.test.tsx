import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Attestation,
  Button,
  Label,
  Logo,
  Table,
  ThemeToggle,
  VerdictChip,
  VerdictTable,
  type AttestationRecord,
  type FunctionRun,
} from "@qed/ui";

/** Behaviour, not markup. Nothing here asserts a class name. */

const EQUIVALENT: FunctionRun = {
  path: "billing/tax.go",
  symbol: "computeVat",
  verdict: { state: "EQUIVALENT", inputs: 18402 },
};

const DIVERGED: FunctionRun = {
  path: "orders/pricing.ts",
  symbol: "bulkRate",
  verdict: {
    state: "DIVERGED",
    counterexample: {
      input: "{ qty: 100 }",
      base: "0.85",
      head: "0.8",
      repro: "qed repro 9f2a1c",
      foundAt: { index: 7, of: 9110 },
    },
  },
};

const ABSTAINED: FunctionRun = {
  path: "api/handlers.go",
  symbol: "CreateOrder",
  verdict: { state: "ABSTAINED", obstruction: "opens a database connection" },
};

const RUNS: FunctionRun[] = [EQUIVALENT, DIVERGED, ABSTAINED];

const RECORD: AttestationRecord = {
  symbol: "computeVat",
  path: "billing/tax.go",
  repository: "acme/ledger",
  commit: "4f2c91a",
  timestamp: "2026-10-04 09:41 UTC",
  verdict: { state: "EQUIVALENT", inputs: 18402 },
  inputStrategy: "type-directed, corpus-seeded",
  controls: ["clock frozen", "network denied"],
  tolerances: [],
  engine: "qed 0.4.1",
  signer: "github-actions (OIDC)",
  rekorIndex: "78 440 213",
  digest: "sha256:9f2a1c",
};

describe("VerdictChip", () => {
  it("shows the state word and its evidence, for every state", () => {
    for (const run of RUNS) {
      const { unmount } = render(<VerdictChip verdict={run.verdict} />);
      expect(screen.getByText(run.verdict.state)).toBeInTheDocument();
      unmount();
    }
  });

  it("prints the input count on a proven verdict", () => {
    render(<VerdictChip verdict={EQUIVALENT.verdict} />);
    expect(screen.getByText("18,402 inputs")).toBeInTheDocument();
  });

  it("prints the obstruction on an abstention, not a euphemism", () => {
    render(<VerdictChip verdict={ABSTAINED.verdict} />);
    expect(
      screen.getByText("opens a database connection"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not verify/i)).not.toBeInTheDocument();
  });
});

describe("VerdictTable", () => {
  it("is a real table with a row per function", () => {
    render(<VerdictTable caption="Verdicts" runs={RUNS} />);
    const table = screen.getByRole("table", { name: "Verdicts" });
    expect(within(table).getAllByRole("row")).toHaveLength(RUNS.length + 1);
  });

  it("names its columns", () => {
    render(<VerdictTable caption="Verdicts" runs={RUNS} />);
    expect(screen.getByRole("columnheader", { name: "FUNCTION" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "EVIDENCE" })).toBeInTheDocument();
  });

  it("says so when a run verified nothing", () => {
    render(<VerdictTable caption="Verdicts" runs={[]} />);
    expect(
      screen.getByText("No verifiable function changed in this run."),
    ).toBeInTheDocument();
  });

  it("carries the counterexample into the evidence column", () => {
    render(<VerdictTable caption="Verdicts" runs={RUNS} />);
    expect(screen.getByText("{ qty: 100 }")).toBeInTheDocument();
  });
});

describe("Attestation", () => {
  it("prints the tolerances row even when no tolerance was applied", () => {
    render(<Attestation record={RECORD} />);
    expect(screen.getByText("TOLERANCES")).toBeInTheDocument();
    expect(screen.getByText("none applied")).toBeInTheDocument();
  });

  it("never collapses the controls row", () => {
    render(<Attestation record={RECORD} />);
    expect(screen.getByText("CONTROLS")).toBeInTheDocument();
    expect(screen.getByText(/clock frozen/)).toBeInTheDocument();
  });

  it("names the signer rather than implying QED vouched for itself", () => {
    render(<Attestation record={RECORD} />);
    expect(screen.getByText(/signer: github-actions \(OIDC\)/)).toBeInTheDocument();
  });

  it("verification is a real action that reports back", async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn();
    const { rerender } = render(
      <Attestation record={RECORD} onVerify={onVerify} />,
    );
    await user.click(screen.getByRole("button", { name: /verify independently/i }));
    expect(onVerify).toHaveBeenCalledTimes(1);

    rerender(
      <Attestation
        record={RECORD}
        onVerify={onVerify}
        verification={{ status: "verified", checkedAt: "2026-10-04 09:41 UTC" }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Re-derived and matched at 2026-10-04 09:41 UTC.",
    );
  });

  it("marks the button busy while a check runs, without taking focus away", async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn();
    const { rerender } = render(
      <Attestation record={RECORD} onVerify={onVerify} />,
    );

    await user.click(
      screen.getByRole("button", { name: /verify independently/i }),
    );
    rerender(
      <Attestation
        record={RECORD}
        onVerify={onVerify}
        verification={{ status: "checking" }}
      />,
    );

    const busy = screen.getByRole("button", { name: /verifying/i });
    expect(busy).toHaveAttribute("aria-busy", "true");
    // Disabling it here would drop focus to <body> mid-interaction.
    expect(busy).not.toBeDisabled();
    expect(busy).toHaveFocus();

    await user.click(busy);
    expect(onVerify).toHaveBeenCalledTimes(1);
  });

  it("says plainly when a record did not re-derive", () => {
    render(
      <Attestation
        record={RECORD}
        verification={{
          status: "mismatch",
          detail: "Re-derivation produced a different digest.",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Re-derivation produced a different digest.",
    );
    expect(screen.getByRole("article")).toHaveAttribute(
      "data-verification",
      "mismatch",
    );
  });
});

describe("Logo", () => {
  it("uses the small mark at 24px and below", () => {
    for (const size of ["xs", "sm"] as const) {
      const { container, unmount } = render(
        <Logo variant="mark" size={size} decorative />,
      );
      expect(container.querySelector("svg")?.dataset["logo"]).toBe("mark-16");
      unmount();
    }
  });

  it("uses the smoothed mark above 24px", () => {
    for (const size of ["md", "lg", "xl"] as const) {
      const { container, unmount } = render(
        <Logo variant="mark" size={size} decorative />,
      );
      expect(container.querySelector("svg")?.dataset["logo"]).toBe("mark");
      unmount();
    }
  });

  it("is named for assistive technology unless it is decorative", () => {
    const { unmount } = render(<Logo variant="lockup" />);
    expect(screen.getByRole("img", { name: "QED" })).toBeInTheDocument();
    unmount();

    const { container } = render(<Logo variant="lockup" decorative />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Button", () => {
  it("is a real button that does not submit by accident", () => {
    render(<Button>Download bundle</Button>);
    expect(screen.getByRole("button", { name: "Download bundle" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("calls back on click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Verify</Button>);
    await user.click(screen.getByRole("button", { name: "Verify" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("Label", () => {
  it("keeps the capitals it was given", () => {
    render(<Label>SIGNED ATTESTATION</Label>);
    expect(screen.getByText("SIGNED ATTESTATION")).toBeInTheDocument();
  });

  it("warns when a caller relies on text-transform instead", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<Label>Signed attestation</Label>);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("Table", () => {
  it("marks the identifying column as a row header", () => {
    render(
      <Table
        caption="Files"
        rows={[{ file: "attestations.json" }]}
        rowKey={(row) => row.file}
        columns={[
          { key: "file", header: "FILE", rowHeader: true, cell: (row) => row.file },
        ]}
      />,
    );
    expect(
      screen.getByRole("rowheader", { name: "attestations.json" }),
    ).toBeInTheDocument();
  });
});

describe("ThemeToggle", () => {
  it("switches the document theme and says where it is going", async () => {
    const user = userEvent.setup();
    document.documentElement.removeAttribute("data-theme");
    render(<ThemeToggle />);

    const button = screen.getByRole("button", {
      name: "Switch to Paper theme (currently Void)",
    });
    await user.click(button);
    expect(document.documentElement.getAttribute("data-theme")).toBe("paper");
    expect(
      screen.getByRole("button", { name: "Switch to Void theme (currently Paper)" }),
    ).toBeInTheDocument();
  });
});
