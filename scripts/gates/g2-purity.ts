import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fail, lineOf, pass, rel, root, walk, type Gate } from "./kit.ts";

// ============================================================ G2 token purity

const PURITY_ROOTS = [
  "packages/ui",
  "packages/cli-render",
  "apps/web",
  "apps/console",
];

/**
 * Explicit, reasoned exemptions. Everything else in those three trees must
 * reach a design value through a generated custom property.
 */
const PURITY_EXEMPT = [
  // The logo files are design-system assets, copied byte-for-byte; G4 asserts
  // their path data never drifts, so they must not be edited to use tokens.
  /packages\/ui\/src\/assets\/logos\/.*\.svg$/,
  // Generated from those same SVGs at build time.
  /packages\/ui\/src\/generated\//,
  // The fallback-metric override file is produced by a measurement run.
  /packages\/ui\/src\/styles\/fallback-metrics\.generated\.css$/,
  // The favicon is qed-mark-16.svg byte-for-byte; a browser tab icon cannot
  // read a custom property, and G4 hashes it with the rest.
  /apps\/(?:web|console)\/public\/favicon\.svg$/,
];

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const COLORFN_RE = /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\s*\(/g;
const LENGTH_RE = /(?<![\w-#])(\d*\.?\d+)(px|rem|pt)(?![\w-])/g;

/** Effects the brand book forbids outright (section 3, rule 3). */
const FORBIDDEN_EFFECTS = [
  { re: /\bbox-shadow\s*:(?!\s*none)/g, what: "box-shadow" },
  { re: /\btext-shadow\s*:(?!\s*none)/g, what: "text-shadow" },
  { re: /\bfilter\s*:(?!\s*none)/g, what: "filter" },
  { re: /\bbackdrop-filter\s*:/g, what: "backdrop-filter" },
  { re: /\b(?:linear|radial|conic)-gradient\s*\(/g, what: "gradient" },
];

/**
 * Blanks comments, keeping every byte offset, so the scan reads code rather
 * than prose. A comment that explains why the focus ring is 2px is not a
 * hard-coded 2px.
 */
function withoutComments(text: string, kind: "ts" | "css" | "other"): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === "ts") {
    // Line comments only; a URL's "//" never starts one at the line level here.
    out = out.replace(/(^|[\s;,({[])\/\/[^\n]*/g, (m) => blank(m));
  }
  if (kind === "other") {
    out = out.replace(/<!--[\s\S]*?-->/g, blank);
  }
  return out;
}

/**
 * A media or container query cannot read a custom property, so breakpoints are
 * the one place a px literal has to appear in a stylesheet. They are still declared -
 * in packages/tokens/src/component-tokens.json as `bp-*` - and this gate
 * asserts every breakpoint in the CSS is one of the declared values.
 */
const declaredBreakpoints = new Set(
  (
    JSON.parse(
      readFileSync(join(root, "packages/tokens/src/component-tokens.json"), "utf8"),
    ) as { tokens: { name: string; value: string }[] }
  ).tokens
    .filter((t) => t.name.startsWith("bp-"))
    .map((t) => t.value),
);

const MEDIA_PRELUDE = /@(?:media|container)[^{]*\{/g;

export const gate: Gate = {
  id: "G2",
  title: "Token purity - no raw colour/size literals, no forbidden effects",
  run() {
    const failures: string[] = [];
    const notes: string[] = [];
    let scanned = 0;

    for (const dir of PURITY_ROOTS) {
      const files = walk(join(root, dir), (p) =>
        [".ts", ".tsx", ".css", ".html", ".svg"].includes(extname(p)),
      );
      for (const file of files) {
        const r = rel(file);
        if (PURITY_EXEMPT.some((re) => re.test(r))) continue;
        scanned++;
        const extension = extname(file);
        const kind =
          extension === ".ts" || extension === ".tsx"
            ? "ts"
            : extension === ".css"
              ? "css"
              : "other";
        const original = withoutComments(readFileSync(file, "utf8"), kind);

        // Check breakpoints against the declared set, then blank the preludes
        // so the length scan does not see them twice.
        const text = original.replace(
          MEDIA_PRELUDE,
          (prelude: string, offset: number) => {
            for (const px of prelude.matchAll(/\d+(?:\.\d+)?px/g)) {
              if (!declaredBreakpoints.has(px[0])) {
                failures.push(
                  `${r}:${lineOf(original, offset + px.index)} breakpoint ${px[0]} is not a declared bp-* token`,
                );
              }
            }
            return " ".repeat(prelude.length);
          },
        );

        for (const m of text.matchAll(HEX_RE)) {
          failures.push(`${r}:${lineOf(text, m.index)} hard-coded colour ${m[0]}`);
        }
        for (const m of text.matchAll(COLORFN_RE)) {
          failures.push(`${r}:${lineOf(text, m.index)} colour function ${m[0]}`);
        }
        for (const m of text.matchAll(LENGTH_RE)) {
          failures.push(`${r}:${lineOf(text, m.index)} hard-coded size ${m[0]}`);
        }
        for (const effect of FORBIDDEN_EFFECTS) {
          for (const m of text.matchAll(effect.re)) {
            failures.push(
              `${r}:${lineOf(text, m.index)} ${effect.what} - the system forbids it (no shadows, no gradients, no blur)`,
            );
          }
        }
      }
    }

    notes.push(`${scanned} source files scanned in ${PURITY_ROOTS.join(", ")}`);
    notes.push(`${PURITY_EXEMPT.length} exemptions, each reasoned in this file`);
    notes.push(
      `breakpoints allowed only from bp-* tokens: ${[...declaredBreakpoints].join(", ")}`,
    );
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};
