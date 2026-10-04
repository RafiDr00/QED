import { render, cleanup } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { VerdictChip, evidenceLine, type Verdict } from "@qed/ui";

/**
 * The property the design system states as a layout law: no verdict renders
 * without its evidence. The type system makes an evidence-free verdict
 * unrepresentable (see packages/ui/type-tests); this checks the other half -
 * that whatever verdict you can build, the chip shows something for it.
 */

/**
 * No '%' in the generated evidence: the last property asserts the component
 * never puts a percentage beside a verdict, and a '%' arriving from the data
 * would make that assertion test nothing.
 */
const nonEmpty = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim() !== "" && !s.includes("%"));

const equivalent = fc
  .record({ inputs: fc.integer({ min: 0, max: 10_000_000 }) })
  .map((v): Verdict => ({ state: "EQUIVALENT", inputs: v.inputs }));

const diverged = fc
  .record({
    input: nonEmpty,
    base: nonEmpty,
    head: nonEmpty,
    repro: nonEmpty,
    index: fc.integer({ min: 1, max: 100_000 }),
    of: fc.integer({ min: 1, max: 100_000 }),
    withLocation: fc.boolean(),
  })
  .map(
    (v): Verdict => ({
      state: "DIVERGED",
      counterexample: {
        input: v.input,
        base: v.base,
        head: v.head,
        repro: v.repro,
        ...(v.withLocation ? { foundAt: { index: v.index, of: v.of } } : {}),
      },
    }),
  );

const abstained = fc
  .record({ obstruction: nonEmpty })
  .map((v): Verdict => ({ state: "ABSTAINED", obstruction: v.obstruction }));

const anyVerdict = fc.oneof(equivalent, diverged, abstained);

describe("every verdict carries evidence", () => {
  it("evidenceLine is never blank, for any verdict that can be built", () => {
    fc.assert(
      fc.property(anyVerdict, (verdict) => {
        expect(evidenceLine(verdict).trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 500 },
    );
  });

  it("the chip renders the state word and something beside it", () => {
    fc.assert(
      fc.property(anyVerdict, (verdict) => {
        const { container } = render(<VerdictChip verdict={verdict} />);
        const text = container.textContent ?? "";
        expect(text).toContain(verdict.state);
        const evidence = text.slice(text.indexOf(verdict.state) + verdict.state.length);
        expect(evidence.trim().length).toBeGreaterThan(0);
        cleanup();
      }),
      { numRuns: 200 },
    );
  });

  it("an EQUIVALENT chip always shows a count, including zero", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (inputs) => {
        const { container } = render(
          <VerdictChip verdict={{ state: "EQUIVALENT", inputs }} />,
        );
        expect(container.textContent ?? "").toMatch(/[\d,]+ inputs/);
        cleanup();
      }),
      { numRuns: 100 },
    );
  });

  it("never prints a confidence or a percentage beside a verdict", () => {
    fc.assert(
      fc.property(anyVerdict, (verdict) => {
        const { container } = render(<VerdictChip verdict={verdict} />);
        const text = container.textContent ?? "";
        // An obstruction could legitimately contain a percent sign; the
        // generated ones never do, so any % here came from the component.
        expect(text).not.toMatch(/\d\s*%/);
        cleanup();
      }),
      { numRuns: 200 },
    );
  });
});
