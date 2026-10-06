import { describe, expect, it } from "vitest";

import { verify } from "@qed/engine";

const run = (base: string, head: string) =>
  verify({ fileName: "s.ts", symbol: "f", base, head }, { inputs: 600 });

/**
 * DIVERGED says that something moved. Almost every diff is meant to move
 * something, so the useful answer is where it bites.
 */
describe("blast radius", () => {
  it("names both conditions of a two-part change, exactly", () => {
    const base = `export function f(o: { qty: number; tier: "gold" | "silver" }): number {
      if (o.tier === "gold" && o.qty > 100) return 0.85;
      return 1;
    }`;
    const head = `export function f(o: { qty: number; tier: "gold" | "silver" }): number {
      if (o.tier === "gold" && o.qty >= 100) return 0.8;
      return 1;
    }`;

    const r = run(base, head);
    expect(r.verdict.state).toBe("DIVERGED");
    expect(r.blast?.exact).toBe(true);
    expect(r.blastSummary).toContain("`tier` is \"gold\"");
    expect(r.blastSummary).toContain("`qty` is at least 100");
  });

  it("measures the share of inputs affected", () => {
    const base = `export function f(n: number): number { return n >= 0 ? 1 : 2; }`;
    const head = `export function f(n: number): number { return n >= 0 ? 1 : 3; }`;
    const r = run(base, head);
    const blast = r.blast;
    expect(blast).toBeDefined();
    if (!blast) return;
    // Only negative inputs differ, so it is a real fraction, not everything.
    expect(blast.diverging).toBeGreaterThan(0);
    expect(blast.diverging).toBeLessThan(blast.sampled);
    expect(r.blastSummary).toMatch(/\d+\.\d% of generated inputs/);
  });

  it("says so plainly when no condition describes the change", () => {
    const base = `export function f(n: number): number { return n; }`;
    const head = `export function f(n: number): number { return n + 1; }`;
    const r = run(base, head);
    const blast = r.blast;
    expect(blast).toBeDefined();
    if (!blast) return;
    // Nearly everything, but not quite: NaN + 1 is NaN and Infinity + 1 is
    // Infinity, so those inputs genuinely agree. Nothing separates the rest.
    expect(blast.diverging / blast.sampled).toBeGreaterThan(0.9);
    expect(blast.conditions).toEqual([]);
    expect(r.blastSummary).toContain("no single condition describes them");
  });

  it("finds a single string condition", () => {
    const base = `export function f(t: string): number { return t === "gold" ? 2 : 1; }`;
    const head = `export function f(t: string): number { return t === "gold" ? 3 : 1; }`;
    const r = run(base, head);
    expect(r.blastSummary).toContain("\"gold\"");
    expect(r.blast?.exact).toBe(true);
  });

  it("is absent when nothing diverged", () => {
    const src = `export function f(n: number): number { return n * 2; }`;
    const r = run(src, src);
    expect(r.verdict.state).toBe("EQUIVALENT");
    expect(r.blast).toBeUndefined();
    expect(r.blastSummary).toBeUndefined();
  });

  it("reaches into a nested field", () => {
    const base = `export function f(o: { order: { qty: number } }): number {
      return o.order.qty > 10 ? 1 : 0;
    }`;
    const head = `export function f(o: { order: { qty: number } }): number {
      return o.order.qty > 20 ? 1 : 0;
    }`;
    const r = run(base, head);
    expect(r.verdict.state).toBe("DIVERGED");
    expect(r.blastSummary).toContain("order.qty");
  });
});
