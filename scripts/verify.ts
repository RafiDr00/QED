/**
 * `pnpm verify` - the definition of done.
 *
 * Ten gates, machine-checked. Static gates read the repo and the built CSS.
 * Runtime gates read evidence written by the Playwright run into .verify/.
 *
 * Flags:
 *   --no-run        evaluate gates against existing build + evidence
 *   --only=G1,G4    run a subset (implies --no-run unless the evidence exists)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { extname, join, relative, sep } from "node:path";

import { contrastHex, round2 } from "./color.ts";
import { geometryOf, pathDataOf } from "./logo-geometry.ts";
import { compareBitmaps, decodePng, lumaStats } from "./png.ts";

const root = process.cwd();
const verifyDir = join(root, ".verify");

const args = process.argv.slice(2);
const noRun = args.includes("--no-run");
const onlyArg = args.find((a) => a.startsWith("--only="));
const only = onlyArg
  ? new Set(onlyArg.slice("--only=".length).split(",").map((s) => s.trim()))
  : null;

// --------------------------------------------------------------- primitives

interface GateResult {
  ok: boolean;
  notes: string[];
  failures: string[];
}

interface Gate {
  id: string;
  title: string;
  run: () => GateResult;
}

const pass = (notes: string[]): GateResult => ({ ok: true, notes, failures: [] });
const fail = (failures: string[], notes: string[] = []): GateResult => ({
  ok: false,
  notes,
  failures,
});

function walk(dir: string, filter: (p: string) => boolean): string[] {
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

function walkIncludingDist(dir: string, filter: (p: string) => boolean): string[] {
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

function readEvidence(name: string): unknown {
  const file = join(verifyDir, name);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

const rel = (p: string) => relative(root, p).split(sep).join("/");

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

const tokens = JSON.parse(
  readFileSync(join(root, "packages/tokens/src/tokens.json"), "utf8"),
) as TokensFile;

const themeIds = tokens.color.themes.map((t) => t.id);

function tokenHex(name: string, theme: string): string {
  const token = tokens.color.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`unknown colour token: ${name}`);
  if (typeof token.value === "string") return token.value;
  const v = token.value[theme] ?? token.value[themeIds[0] ?? ""];
  if (v === undefined) throw new Error(`${name} has no value for ${theme}`);
  return v;
}

// =============================================================== G1 contrast

/**
 * Pairs the gate asserts at token level, on top of the runtime sweep. Each is
 * a real surface in the product; `kind` sets the WCAG threshold.
 */
const DECLARED_PAIRS: {
  fg: string;
  bg: string;
  kind: "body" | "large" | "nonText";
  where: string;
  /** Omitted means both themes. */
  themes?: string[];
}[] = [
  { fg: "ink", bg: "bg", kind: "body", where: "page body copy" },
  { fg: "ink", bg: "bg-raised", kind: "body", where: "card body copy" },
  { fg: "ink", bg: "bg-sunk", kind: "body", where: "terminal output" },
  { fg: "ink", bg: "proof-dim", kind: "body", where: "attestation body" },
  { fg: "ink-muted", bg: "bg", kind: "body", where: "metadata" },
  { fg: "ink-muted", bg: "bg-raised", kind: "body", where: "table second line" },
  { fg: "ink-muted", bg: "bg-sunk", kind: "body", where: "terminal evidence" },
  { fg: "proof", bg: "bg", kind: "body", where: "links, EQUIVALENT" },
  { fg: "proof", bg: "bg-raised", kind: "body", where: "verdict chip word" },
  {
    fg: "proof",
    bg: "bg-sunk",
    kind: "body",
    where: "terminal EQUIVALENT",
    // Void only: on Paper the pane sits on bg-raised, because `proof` is
    // 4.24:1 on bg-sunk there. See terminal.css and DECISIONS.md D-005.
    themes: ["void"],
  },
  { fg: "break", bg: "bg", kind: "body", where: "DIVERGED" },
  { fg: "break", bg: "bg-raised", kind: "body", where: "verdict chip word" },
  { fg: "break", bg: "bg-sunk", kind: "body", where: "terminal DIVERGED" },
  { fg: "open", bg: "bg", kind: "body", where: "ABSTAINED" },
  { fg: "open", bg: "bg-raised", kind: "body", where: "verdict chip word" },
  { fg: "open", bg: "bg-sunk", kind: "body", where: "terminal ABSTAINED" },
  { fg: "bg-raised", bg: "proof", kind: "body", where: "primary button label" },
  { fg: "bg-raised", bg: "proof-press", kind: "body", where: "pressed button label" },
  { fg: "focus", bg: "bg", kind: "nonText", where: "focus ring on page" },
  { fg: "focus", bg: "bg-raised", kind: "nonText", where: "focus ring on card" },
  { fg: "focus", bg: "bg-sunk", kind: "nonText", where: "focus ring on terminal" },
  { fg: "focus", bg: "proof-dim", kind: "nonText", where: "focus ring on attestation" },
  { fg: "proof", bg: "proof-dim", kind: "nonText", where: "attestation eyebrow mark" },
  { fg: "ink", bg: "proof-dim", kind: "nonText", where: "attestation verdict glyph" },
  { fg: "proof", bg: "bg", kind: "nonText", where: "EQUIVALENT dot" },
  { fg: "break", bg: "bg", kind: "nonText", where: "DIVERGED dot" },
  { fg: "open", bg: "bg", kind: "nonText", where: "ABSTAINED dot ring" },
  { fg: "proof", bg: "bg-raised", kind: "nonText", where: "dot on a card" },
  { fg: "break", bg: "bg-raised", kind: "nonText", where: "dot on a card" },
  { fg: "open", bg: "bg-raised", kind: "nonText", where: "dot on a card" },
];

/**
 * Documented exemption. `rule` (1.24:1 in Void) and `rule-strong` (1.76:1) are
 * the system's single hairline: dividers and table rules. WCAG 1.4.11 covers
 * non-text content *required to identify a control or its state*; a divider is
 * not one, and no control in this repo depends on a hairline to be found - every
 * control carries a 4.5:1 label and a 3:1 focus ring. Recorded here rather than
 * silently skipped. See DECISIONS.md D-004.
 */
const BORDER_EXEMPTIONS = ["rule", "rule-strong"];

interface RuntimePair {
  route: string;
  theme: string;
  selector: string;
  sample: string;
  fg: string;
  bg: string;
  fontSize: number;
  fontWeight: number;
  ratio: number;
  required: number;
  ok: boolean;
  isFocusRing?: boolean;
}

interface ContrastEvidence {
  pairs: RuntimePair[];
  textColoursUsed: { theme: string; color: string; selector: string }[];
}

const g1: Gate = {
  id: "G1",
  title: "Contrast - every text/background pair in both themes",
  run() {
    const failures: string[] = [];
    const notes: string[] = [];

    let checked = 0;
    for (const theme of themeIds) {
      for (const pair of DECLARED_PAIRS) {
        if (pair.themes && !pair.themes.includes(theme)) continue;
        checked++;
        const fg = tokenHex(pair.fg, theme);
        const bg = tokenHex(pair.bg, theme);
        const ratio = round2(contrastHex(fg, bg));
        const required = pair.kind === "body" ? 4.5 : 3;
        if (ratio < required) {
          failures.push(
            `${theme}: ${pair.fg} on ${pair.bg} is ${ratio}:1, needs ${required}:1 (${pair.where})`,
          );
        }
      }
    }
    notes.push(`${checked} declared token pairs checked across both themes`);
    notes.push(
      `hairline exemption recorded for ${BORDER_EXEMPTIONS.join(", ")} (DECISIONS.md D-004)`,
    );

    // proof-press is declared in tokens.json as "never used as a text colour".
    const evidence = readEvidence("contrast.json") as ContrastEvidence | null;
    if (!evidence) {
      failures.push("no .verify/contrast.json - the e2e evidence run did not produce it");
      return fail(failures, notes);
    }

    for (const theme of themeIds) {
      const banned = tokenHex("proof-press", theme).toLowerCase();
      const used = evidence.textColoursUsed.filter(
        (u) => u.theme === theme && u.color.toLowerCase() === banned,
      );
      for (const u of used) {
        failures.push(
          `${theme}: proof-press used as a text colour on ${u.selector} (tokens.json forbids it)`,
        );
      }
    }

    const runtimeFailures = evidence.pairs.filter((p) => !p.ok);
    for (const p of runtimeFailures.slice(0, 20)) {
      failures.push(
        `${p.theme} ${p.route} ${p.selector}: ${round2(p.ratio)}:1 < ${p.required}:1 ` +
          `(${p.fg} on ${p.bg}, ${p.fontSize}px/${p.fontWeight}) "${p.sample.slice(0, 40)}"`,
      );
    }
    if (runtimeFailures.length > 20) {
      failures.push(`...and ${runtimeFailures.length - 20} more runtime pairs`);
    }
    notes.push(`${evidence.pairs.length} rendered text nodes swept across both themes`);

    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

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

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

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

const g2: Gate = {
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

// ===================================================================== G3 grid

/** Values allowed off the 4px grid, each with the token that justifies it. */
const GRID_EXCEPTIONS = new Map<string, string>([
  ["0", "zero"],
  ["1px", "border-hair - the system's one hairline"],
  ["2px", "border-rule / radius-1 - the attestation rule, the focus ring, chip corners"],
  ["999px", "radius-round - the verdict dot"],
  ["5.5%", "radius-mark - a percentage so the mark's curve scales"],
]);

const GRID_PROPS = [
  "line-height",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "gap",
  "row-gap",
  "column-gap",
  "border-radius",
];

function builtCssFiles(): string[] {
  const files: string[] = [];
  const tokensCss = join(root, "packages/tokens/dist/tokens.css");
  if (existsSync(tokensCss)) files.push(tokensCss);
  for (const app of ["apps/web/dist", "apps/console/dist"]) {
    files.push(
      ...walkIncludingDist(join(root, app), (p) => extname(p) === ".css"),
    );
  }
  files.push(
    ...walk(join(root, "packages/ui/src/styles"), (p) => extname(p) === ".css"),
  );
  return files;
}

const g3: Gate = {
  id: "G3",
  title: "Grid - every line-height, spacing and radius on the 4px grid",
  run() {
    const failures: string[] = [];
    const notes: string[] = [];
    const files = builtCssFiles();
    if (files.length === 0) {
      return fail(["no built CSS found - run the build first"]);
    }

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const r = rel(file);

      // Token definitions carry the real values; declarations mostly carry var().
      for (const m of text.matchAll(/--([a-z0-9-]+)\s*:\s*([^;}]+)[;}]/g)) {
        const name = m[1] ?? "";
        const value = (m[2] ?? "").trim();
        if (!/^(space|radius|type-.*-line)/.test(name)) continue;
        if (GRID_EXCEPTIONS.has(value) || value.startsWith("var(")) continue;
        const px = /^(\d*\.?\d+)px$/.exec(value);
        if (!px?.[1]) {
          failures.push(`${r}: --${name}: ${value} is neither a px value nor a listed exception`);
          continue;
        }
        if (Number(px[1]) % 4 !== 0) {
          failures.push(`${r}: --${name}: ${value} is off the 4px grid`);
        }
      }

      for (const m of text.matchAll(
        new RegExp(`(?:^|[;{\\s])(${GRID_PROPS.join("|")})\\s*:\\s*([^;}]+)`, "g"),
      )) {
        const prop = m[1] ?? "";
        const value = (m[2] ?? "").trim();
        for (const part of value.split(/\s+/)) {
          if (
            part.startsWith("var(") ||
            part.startsWith("calc(") ||
            GRID_EXCEPTIONS.has(part) ||
            /^(auto|inherit|normal|unset|initial|\d+(\.\d+)?%|\d+(\.\d+)?(em|ch|fr))$/.test(part)
          ) {
            continue;
          }
          const px = /^(\d*\.?\d+)px$/.exec(part);
          if (px?.[1]) {
            if (Number(px[1]) % 4 !== 0) {
              failures.push(
                `${r}:${lineOf(text, m.index)} ${prop}: ${part} is off the 4px grid`,
              );
            }
            continue;
          }
          if (/^\d*\.?\d+$/.test(part) && prop === "line-height") {
            failures.push(
              `${r}:${lineOf(text, m.index)} unitless line-height ${part} - the grid needs a px value`,
            );
          }
        }
      }
    }

    notes.push(`${files.length} built CSS files checked`);
    notes.push(
      `exceptions: ${[...GRID_EXCEPTIONS.entries()].map(([k, v]) => `${k} (${v})`).join("; ")}`,
    );
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ============================================================ G4 logo fidelity

interface LogoBaseline {
  source: string;
  files: Record<
    string,
    {
      artifactSha256: string;
      pathDataSha256: string;
      geometrySha256: string;
      paths: string[];
      geometry: string[];
    }
  >;
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const g4: Gate = {
  id: "G4",
  title: "Logo fidelity - shipped path data identical to the design system",
  run() {
    const baselineFile = join(root, "design-system/logo-paths.json");
    if (!existsSync(baselineFile)) {
      return fail(["design-system/logo-paths.json missing - run scripts/snapshot-logos.ts"]);
    }
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as LogoBaseline;
    const failures: string[] = [];
    const notes: string[] = [];

    for (const [name, entry] of Object.entries(baseline.files)) {
      const src = join(root, "packages/ui/src/assets/logos", name);
      if (!existsSync(src)) {
        failures.push(`${name}: missing from packages/ui/src/assets/logos`);
        continue;
      }
      const raw = readFileSync(src);
      const fileHash = createHash("sha256").update(raw).digest("hex");
      if (fileHash !== entry.artifactSha256) {
        failures.push(
          `${name}: file bytes differ from the design system (${fileHash.slice(0, 12)} != ${entry.artifactSha256.slice(0, 12)})`,
        );
      }
      const text = raw.toString("utf8");
      const paths = pathDataOf(text);
      if (sha256(paths.join("|")) !== entry.pathDataSha256) {
        failures.push(`${name}: path 'd' data drifted`);
      }
      // Rects and the viewBox too: the wordmark's stems are rects.
      if (sha256(geometryOf(text).join("|")) !== entry.geometrySha256) {
        failures.push(`${name}: the drawing's geometry drifted (viewBox or a rect)`);
      }
    }

    // The generated module the components actually render from.
    const generated = join(root, "packages/ui/src/generated/logos.ts");
    if (!existsSync(generated)) {
      failures.push("packages/ui/src/generated/logos.ts missing - run the logo generator");
    } else {
      const text = readFileSync(generated, "utf8");
      for (const [name, entry] of Object.entries(baseline.files)) {
        for (const d of entry.paths) {
          if (!text.includes(d)) {
            failures.push(`generated/logos.ts: path from ${name} is missing or altered`);
            break;
          }
        }
      }
    }

    // And the shipped bundles.
    const shipped = [
      ...walkIncludingDist(join(root, "apps/web/dist"), (p) =>
        [".html", ".js", ".svg"].includes(extname(p)),
      ),
      ...walkIncludingDist(join(root, "apps/console/dist"), (p) =>
        [".html", ".js", ".svg"].includes(extname(p)),
      ),
    ];
    if (shipped.length === 0) {
      failures.push("no built app output to check the shipped logo against");
    } else {
      const known = new Set(
        Object.values(baseline.files).flatMap((entry) => entry.paths),
      );

      // 1. The prerendered HTML carries real <svg class="qed-logo"> blocks.
      //    Every path inside one must be a design-system path - no prefix
      //    filter, because a filter that only looks at paths which already
      //    start like the real thing cannot see a redrawn mark.
      let inspectedBlocks = 0;
      let inspectedPaths = 0;
      for (const file of shipped.filter((f) => extname(f) === ".html")) {
        const text = readFileSync(file, "utf8");
        for (const block of text.matchAll(
          /<svg[^>]*class="[^"]*qed-logo[^"]*"[\s\S]*?<\/svg>/g,
        )) {
          inspectedBlocks++;
          for (const m of block[0].matchAll(/\sd="([^"]+)"/g)) {
            const d = m[1];
            if (d === undefined) continue;
            inspectedPaths++;
            if (!known.has(d)) {
              failures.push(
                `${rel(file)}: a path inside a .qed-logo svg is not in the design system - "${d.slice(0, 48)}..."`,
              );
            }
          }
        }
      }

      // 2. The bundles hold the paths as string literals rather than markup.
      //    If a bundle contains the start of a logo path it must contain all
      //    of it, so a truncated or edited path cannot slip through.
      let bundlesWithLogos = 0;
      for (const file of shipped.filter((f) => extname(f) === ".js")) {
        const text = readFileSync(file, "utf8");
        let holdsLogo = false;
        for (const [name, entry] of Object.entries(baseline.files)) {
          for (const d of entry.paths) {
            const head = d.slice(0, 24);
            if (!text.includes(head)) continue;
            holdsLogo = true;
            if (!text.includes(d)) {
              failures.push(
                `${rel(file)}: a path from ${name} starts correctly but does not match - it was edited`,
              );
            }
          }
        }
        if (holdsLogo) bundlesWithLogos++;
      }

      if (inspectedBlocks === 0 && bundlesWithLogos === 0) {
        failures.push("no logo path data found in the shipped output at all");
      } else {
        notes.push(
          `${inspectedPaths} paths in ${inspectedBlocks} shipped .qed-logo blocks, ` +
            `${bundlesWithLogos} bundle(s) carrying logo paths, all verbatim`,
        );
      }
    }

    notes.push(`${Object.keys(baseline.files).length} logo files hashed against ${baseline.source}`);
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ============================================================== G5 mark optics

interface MarkEvidence {
  renders: {
    size: number;
    variant: string;
    cutEdgeFraction: number;
    cutSideFraction: number;
    cornerIsSquare: boolean;
    cornerRadiusFraction: number;
    cutAngleDegrees: number;
    bottomLeftIsInk: boolean;
    topRightIsInk: boolean;
    inkFraction: number;
  }[];
}

/**
 * What each file is, from the design system's own table:
 *   qed-mark.svg     corners 5.5% of the side, cut 46%, 32px and up
 *   qed-mark-16.svg  corners square,            cut 52%, 24px and below
 *
 * Checking the cut as a fraction of the side, and whether the corner is
 * square, is what actually tells the two files apart. Checking only that
 * "something is cut" passes either file, and would pass a mark with a 20% cut.
 */
const MARK_SPEC = {
  mark: { cut: 0.46, cornerIsSquare: false, radius: 0.055 },
  "mark-16": { cut: 0.52, cornerIsSquare: true, radius: 0 },
} as const;

/** Rasterising a 16px mark at 4x leaves about this much slack. */
const CUT_TOLERANCE = 0.04;

const g5: Gate = {
  id: "G5",
  title: "Mark optics - the right variant at each size, and the cut still reads",
  run() {
    const evidence = readEvidence("mark-optics.json") as MarkEvidence | null;
    if (!evidence) return fail(["no .verify/mark-optics.json from the e2e run"]);
    const failures: string[] = [];
    const notes: string[] = [];

    const expectedSizes = [16, 24, 32, 48];
    for (const size of expectedSizes) {
      const render = evidence.renders.find((r) => r.size === size);
      if (!render) {
        failures.push(`no render recorded at ${size}px`);
        continue;
      }
      // The design system: qed-mark-16 at 24px and below, qed-mark above it.
      const expected = size <= 24 ? "mark-16" : "mark";
      if (render.variant !== expected) {
        failures.push(
          `${size}px rendered the '${render.variant}' variant, expected '${expected}'`,
        );
      }
      if (render.cutEdgeFraction < 0.4) {
        failures.push(
          `${size}px: the cut covers ${round2(render.cutEdgeFraction * 100)}% of the bottom-right quadrant edge, needs 40%`,
        );
      }

      const spec = MARK_SPEC[expected];
      const drift = Math.abs(render.cutSideFraction - spec.cut);
      if (drift > CUT_TOLERANCE) {
        failures.push(
          `${size}px: the cut is ${round2(render.cutSideFraction * 100)}% of the side, and '${expected}' is drawn at ${round2(spec.cut * 100)}%`,
        );
      }
      // A squircle's ink reaches the top edge sooner than its nominal radius,
      // so the measured inset is a fraction of it - but a 15% corner would
      // still be nowhere near a 5.5% one.
      const radiusDrift = Math.abs(render.cornerRadiusFraction - spec.radius);
      if (radiusDrift > 0.05) {
        failures.push(
          `${size}px: the corner rounds at ${round2(render.cornerRadiusFraction * 100)}% of the side, and '${expected}' rounds at ${round2(spec.radius * 100)}%`,
        );
      }
      // "The cut stays razor-sharp against them" - and at 45 degrees, the
      // same angle as the wordmark's `e` aperture. One geometric idea, twice.
      if (Math.abs(render.cutAngleDegrees - 45) > 4) {
        failures.push(
          `${size}px: the cut runs at ${round2(render.cutAngleDegrees)} degrees, and the system cuts at 45`,
        );
      }

      // The cut is in the bottom-right corner. Both other corners stay solid,
      // which is what a mirrored or rotated mark would break while keeping
      // every path byte identical.
      if (!render.bottomLeftIsInk) {
        failures.push(
          `${size}px: the bottom-left corner is cut away - the mark is mirrored or rotated`,
        );
      }
      if (!render.topRightIsInk) {
        failures.push(
          `${size}px: the top-right corner is cut away - the mark is rotated`,
        );
      }

      if (render.cornerIsSquare !== spec.cornerIsSquare) {
        failures.push(
          `${size}px: corner is ${render.cornerIsSquare ? "square" : "smoothed"}, and '${expected}' has ${spec.cornerIsSquare ? "square" : "smoothed"} corners`,
        );
      }

      notes.push(
        `${size}px ${render.variant}: cut ${round2(render.cutSideFraction * 100)}% of the side ` +
          `(${render.cornerIsSquare ? "square" : "smoothed"} corners, radius ${round2(render.cornerRadiusFraction * 100)}%, cut at ${round2(render.cutAngleDegrees)} deg), ` +
          `${round2(render.cutEdgeFraction * 100)}% of the quadrant edge, ink ${round2(render.inkFraction * 100)}%`,
      );
    }
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ============================================================= G6 theme parity

interface ShotEvidence {
  shots: { name: string; theme: string; file: string }[];
}

const g6: Gate = {
  id: "G6",
  title: "Theme parity - every component shot in both themes, neither blank",
  run() {
    const evidence = readEvidence("screenshots.json") as ShotEvidence | null;
    if (!evidence) return fail(["no .verify/screenshots.json from the e2e run"]);
    const failures: string[] = [];
    const notes: string[] = [];

    const byName = new Map<string, Map<string, string>>();
    for (const shot of evidence.shots) {
      const entry = byName.get(shot.name) ?? new Map<string, string>();
      entry.set(shot.theme, shot.file);
      byName.set(shot.name, entry);
    }
    if (byName.size === 0) failures.push("no screenshots recorded");

    for (const [name, themes] of byName) {
      for (const theme of themeIds) {
        if (!themes.has(theme)) failures.push(`${name}: no ${theme} screenshot`);
      }
      const files = themeIds.map((t) => themes.get(t));
      const bitmaps = files.map((f) => {
        if (!f) return null;
        const full = join(root, f);
        if (!existsSync(full)) return null;
        return decodePng(readFileSync(full));
      });

      bitmaps.forEach((bitmap, i) => {
        const theme = themeIds[i];
        if (!bitmap) {
          failures.push(`${name} (${theme}): screenshot file missing`);
          return;
        }
        const stats = lumaStats(bitmap);
        if (stats.stdDev < 2 || stats.distinctValues < 5) {
          failures.push(
            `${name} (${theme}): screenshot looks blank (sd ${round2(stats.stdDev)}, ${stats.distinctValues} luma values)`,
          );
        }
      });

      const [a, b] = bitmaps;
      if (a && b) {
        const diff = compareBitmaps(a, b);
        // Both themes share every metric, so a size difference means the
        // shot caught the component mid-layout - not a theme difference.
        if (!diff.dimensionsMatch) {
          failures.push(
            `${name}: the two theme shots are different sizes (${a.width}x${a.height} vs ${b.width}x${b.height}) - the comparison would prove nothing`,
          );
        } else if (
          // Void is the dark theme and Paper the light one; a palette that
          // merely differed would pass the ratio check on its own.
          lumaStats(a).mean >= lumaStats(b).mean
        ) {
          failures.push(
            `${name}: the void shot is not darker than the paper one ` +
              `(${round2(lumaStats(a).mean)} vs ${round2(lumaStats(b).mean)}) - the themes are not what they say`,
          );
        } else if (diff.ratio < 0.1) {
          failures.push(
            `${name}: void and paper differ on only ${round2(diff.ratio * 100)}% of pixels - the theme is not switching`,
          );
        } else {
          notes.push(
            `${name}: themes differ on ${round2(diff.ratio * 100)}% of pixels`,
          );
        }
      }
    }

    notes.unshift(`${byName.size} components x ${themeIds.length} themes`);
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ========================================================= G7 verdict integrity

interface TypeTestEvidence {
  invalid: { file: string; expectedErrors: number; actualErrors: number }[];
  valid: { file: string; errors: number }[];
}

const g7: Gate = {
  id: "G7",
  title: "Verdict integrity - evidence-free verdicts cannot be constructed",
  run() {
    const evidence = readEvidence("type-tests.json") as TypeTestEvidence | null;
    if (!evidence) {
      return fail(["no .verify/type-tests.json - run scripts/type-tests.ts"]);
    }
    const failures: string[] = [];
    const notes: string[] = [];

    for (const t of evidence.invalid) {
      if (t.actualErrors < t.expectedErrors) {
        failures.push(
          `${t.file}: ${t.actualErrors} type errors, expected at least ${t.expectedErrors} - it must not type-check`,
        );
      } else {
        notes.push(`${t.file}: rejected by the compiler (${t.actualErrors} errors)`);
      }
    }
    for (const t of evidence.valid) {
      if (t.errors > 0) {
        failures.push(`${t.file}: a legal verdict failed to type-check (${t.errors} errors)`);
      }
    }
    if (evidence.invalid.length === 0) {
      failures.push("no negative type tests found - G7 would be vacuous");
    }
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ======================================================================= G8 a11y

interface AxeEvidence {
  runs: {
    route: string;
    theme: string;
    violations: { id: string; impact: string; nodes: number; help: string }[];
  }[];
}

const g8: Gate = {
  id: "G8",
  title: "a11y - axe-core reports zero violations on every route, both themes",
  run() {
    const evidence = readEvidence("axe.json") as AxeEvidence | null;
    if (!evidence) return fail(["no .verify/axe.json from the e2e run"]);
    const failures: string[] = [];
    for (const run of evidence.runs) {
      for (const v of run.violations) {
        failures.push(
          `${run.route} (${run.theme}): ${v.id} [${v.impact}] on ${v.nodes} node(s) - ${v.help}`,
        );
      }
    }
    const notes = [`${evidence.runs.length} route/theme combinations scanned`];
    if (evidence.runs.length === 0) failures.push("no routes scanned");
    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ============================================================== G9 bundle budget

const WEB_JS_BUDGET_BYTES = 40 * 1024;

const g9: Gate = {
  id: "G9",
  title: "Bundle budget - marketing site ships under 40KB of gzipped JS",
  run() {
    const dist = join(root, "apps/web/dist");
    if (!existsSync(dist)) return fail(["apps/web/dist missing - build first"]);
    const jsFiles = walkIncludingDist(dist, (p) => extname(p) === ".js");
    let total = 0;
    const notes: string[] = [];
    for (const file of jsFiles) {
      const gz = gzipSync(readFileSync(file)).byteLength;
      total += gz;
      notes.push(`${rel(file)}: ${gz} B gzipped`);
    }

    // Inline <script> blocks count too - that is where a theme bootstrap hides.
    for (const html of walkIncludingDist(dist, (p) => extname(p) === ".html")) {
      const text = readFileSync(html, "utf8");
      for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        const body = m[1] ?? "";
        if (body.trim().length === 0) continue;
        const gz = gzipSync(Buffer.from(body, "utf8")).byteLength;
        total += gz;
        notes.push(`${rel(html)} inline script: ${gz} B gzipped`);
      }
    }

    notes.unshift(`total ${total} B gzipped of ${WEB_JS_BUDGET_BYTES} B budget`);
    return total <= WEB_JS_BUDGET_BYTES
      ? pass(notes)
      : fail(
          [`marketing JS is ${total} B gzipped, over the ${WEB_JS_BUDGET_BYTES} B budget`],
          notes,
        );
  },
};

// ====================================================================== G10 print

interface GlyphComparison {
  a: string;
  b: string;
  ratio: number;
  dimensionsMatch: boolean;
}

interface PrintEvidence {
  pdf: { file: string; bytes: number };
  glyphs: { state: string; file: string }[];
  pairwiseDifference: GlyphComparison[];
  /** Read back from the page under print media emulation. */
  printed: { ground: string; rows: string[]; buttons: number };
}

/** The Paper ground, which is what a printed page must be on. */
const PAPER_BG = "rgb(250, 249, 246)";

/** Rows the attestation may never drop to save space. */
const REQUIRED_ROWS = ["VERDICT", "INPUTS", "CONTROLS", "TOLERANCES", "ENGINE"];

const g10: Gate = {
  id: "G10",
  title: "Print - the attestation survives greyscale, glyphs stay distinguishable",
  run() {
    const evidence = readEvidence("print.json") as PrintEvidence | null;
    if (!evidence) return fail(["no .verify/print.json from the e2e run"]);
    const failures: string[] = [];
    const notes: string[] = [];

    if (evidence.pdf.bytes < 2000) {
      failures.push(`the attestation PDF is only ${evidence.pdf.bytes} B - it did not render`);
    } else {
      notes.push(`PDF ${evidence.pdf.bytes} B at ${evidence.pdf.file}`);
    }

    // A byte count alone would pass a blank page, so read the printed card
    // back from the page under print media.
    const printed = evidence.printed;
    if (printed.ground !== PAPER_BG) {
      failures.push(
        `under print media the attestation sits on ${printed.ground}, not the Paper ground ${PAPER_BG} - ` +
          `a reader who used the theme toggle would print the audit page in Void`,
      );
    } else {
      notes.push("print media resolves to Paper even with [data-theme] set");
    }
    for (const row of REQUIRED_ROWS) {
      if (!printed.rows.includes(row)) {
        failures.push(`the printed attestation is missing its ${row} row`);
      }
    }
    if (printed.buttons !== 0) {
      failures.push(
        `${printed.buttons} button(s) survive into print - the filed page has nothing to press`,
      );
    } else {
      notes.push(`${printed.rows.length} field rows printed, no controls`);
    }

    if (evidence.glyphs.length !== 3) {
      failures.push(`expected 3 verdict glyphs in greyscale, found ${evidence.glyphs.length}`);
    }
    for (const pair of evidence.pairwiseDifference) {
      if (!pair.dimensionsMatch) {
        failures.push(
          `${pair.a} and ${pair.b} were rendered at different sizes - the comparison is not a shape comparison`,
        );
        continue;
      }
      if (pair.ratio < 0.08) {
        failures.push(
          `${pair.a} and ${pair.b} differ on only ${round2(pair.ratio * 100)}% of pixels in greyscale - colour is carrying the verdict`,
        );
      } else {
        notes.push(`${pair.a} vs ${pair.b}: ${round2(pair.ratio * 100)}% of pixels differ`);
      }
    }
    if (evidence.pairwiseDifference.length < 3) {
      failures.push("fewer than 3 glyph comparisons recorded");
    }

    // And again at the 9px the chips actually render, which is the size a
    // reader has to tell them apart at.
    const shipped = readEvidence("glyphs-9px.json") as {
      shippedSize: GlyphComparison[];
    } | null;
    if (!shipped) {
      failures.push("no .verify/glyphs-9px.json from the e2e run");
    } else {
      for (const pair of shipped.shippedSize) {
        if (!pair.dimensionsMatch) {
          failures.push(
            `at 9px, ${pair.a} and ${pair.b} were rendered at different sizes`,
          );
          continue;
        }
        if (pair.ratio < 0.08) {
          failures.push(
            `at 9px, ${pair.a} and ${pair.b} differ on only ${round2(pair.ratio * 100)}% of pixels in greyscale`,
          );
        } else {
          notes.push(
            `at 9px: ${pair.a} vs ${pair.b}, ${round2(pair.ratio * 100)}% of pixels differ`,
          );
        }
      }
      if (shipped.shippedSize.length < 3) {
        failures.push("fewer than 3 glyph comparisons at the shipped size");
      }
    }

    return failures.length === 0 ? pass(notes) : fail(failures, notes);
  },
};

// ==================================================================== execution

const gates: Gate[] = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10];

function run(label: string, command: string, commandArgs: string[]): boolean {
  process.stdout.write(`\n  -> ${label}: ${command} ${commandArgs.join(" ")}\n`);
  const result = spawnSync(command, commandArgs, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: root,
  });
  return result.status === 0;
}

function main(): void {
  const started = Date.now();
  process.stdout.write("QED verify\n==========\n");

  const prerequisiteFailures: string[] = [];
  if (!noRun && !only) {
    const steps: [string, string, string[]][] = [
      ["build", "pnpm", ["build"]],
      ["typecheck", "pnpm", ["typecheck"]],
      ["lint", "pnpm", ["lint"]],
      ["unit tests", "pnpm", ["test"]],
      ["type tests", "pnpm", ["exec", "tsx", "scripts/type-tests.ts"]],
      ["e2e + evidence", "pnpm", ["e2e"]],
    ];
    for (const [label, cmd, cmdArgs] of steps) {
      if (!run(label, cmd, cmdArgs)) {
        prerequisiteFailures.push(label);
        if (label === "build") break;
      }
    }
  }

  process.stdout.write("\nGates\n-----\n");
  const results: { gate: Gate; result: GateResult }[] = [];
  for (const gate of gates) {
    if (only && !only.has(gate.id)) continue;
    let result: GateResult;
    try {
      result = gate.run();
    } catch (error) {
      result = fail([`${gate.id} threw: ${String(error)}`]);
    }
    results.push({ gate, result });
    process.stdout.write(
      `${result.ok ? "PASS" : "FAIL"}  ${gate.id}  ${gate.title}\n`,
    );
    for (const note of result.notes) process.stdout.write(`        . ${note}\n`);
    for (const f of result.failures) process.stdout.write(`        X ${f}\n`);
  }

  const failed = results.filter((r) => !r.result.ok);
  const seconds = Math.round((Date.now() - started) / 1000);
  process.stdout.write(
    `\n${results.length - failed.length}/${results.length} gates passed in ${seconds}s\n`,
  );
  if (prerequisiteFailures.length > 0) {
    process.stdout.write(`failed steps: ${prerequisiteFailures.join(", ")}\n`);
  }
  if (failed.length > 0 || prerequisiteFailures.length > 0) {
    process.stdout.write("\nverify: FAILED\n");
    process.exit(1);
  }
  process.stdout.write("\nverify: OK\n");
}

main();
