import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  fail,
  lineOf,
  pass,
  rel,
  root,
  walk,
  walkIncludingDist,
  type Gate,
} from "./kit.ts";

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

export const gate: Gate = {
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
