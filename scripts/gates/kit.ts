import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * What every gate shares: the repo on disk, the evidence the e2e run wrote,
 * and the palette the design system defines.
 */


export const root = process.cwd();
export const verifyDir = join(root, ".verify");

// --------------------------------------------------------------- primitives

export interface GateResult {
  ok: boolean;
  notes: string[];
  failures: string[];
}

export interface Gate {
  id: string;
  title: string;
  run: () => GateResult;
}

export const pass = (notes: string[]): GateResult => ({ ok: true, notes, failures: [] });
export const fail = (failures: string[], notes: string[] = []): GateResult => ({
  ok: false,
  notes,
  failures,
});

export function walk(dir: string, filter: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "dist", ".verify", "test-results"].includes(entry.name)) {
        continue;
      }
      out.push(...walk(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

export function walkIncludingDist(dir: string, filter: (p: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...walkIncludingDist(full, filter));
    } else if (filter(full)) {
      out.push(full);
    }
  }
  return out;
}

export function readEvidence(name: string): unknown {
  const file = join(verifyDir, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

export const rel = (p: string) => relative(root, p).split(sep).join("/");

// ------------------------------------------------------------------ sources

interface TokensFile {
  color: {
    themes: { id: string; name: string }[];
    tokens: { name: string; value: string | Record<string, string>; usage?: string }[];
  };
  spacing: { tokens: { name: string; value: string }[] };
  radius: { tokens: { name: string; value: string }[] };
  border: { tokens: { name: string; value: string }[] };
  type: { groups: { styles: { name: string; lineHeight: string | number }[] }[] };
}

export const tokens = JSON.parse(
  readFileSync(join(root, "packages/tokens/src/tokens.json"), "utf8"),
) as TokensFile;

export const themeIds = tokens.color.themes.map((t) => t.id);

export function tokenHex(name: string, theme: string): string {
  const token = tokens.color.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`unknown colour token: ${name}`);
  if (typeof token.value === "string") return token.value;
  const v = token.value[theme] ?? token.value[themeIds[0] ?? ""];
  if (v === undefined) throw new Error(`${name} has no value for ${theme}`);
  return v;
}

/** Which line an offset falls on, for a finding that points at a file. */
export function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
