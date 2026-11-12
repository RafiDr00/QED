/**
 * Bundles the CLI into one CommonJS file: packages/cli/dist/qed.cjs.
 *
 * "One binary, no daemon." A single-executable application runs exactly one
 * script and can require nothing but Node's built-ins, so everything the CLI
 * uses - the engine, the renderer, the model, fast-check and the TypeScript
 * compiler the engine reads source with - is inlined here. The same file runs
 * on its own under `node`, which is how the binary is smoke-tested before it
 * is wrapped.
 *
 * Run: pnpm build:cli
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { build } from "esbuild";

import { libClosure } from "../packages/engine/src/libs.ts";

const root = process.cwd();
export const BUNDLE = join(root, "packages/cli/dist/qed.cjs");

// The type checker reads the standard library's declarations. The binary has
// no typescript package on disk to read them from, so the files it needs are
// embedded, and packages/engine/src/libs.ts reads them from here.
const libs = libClosure();

const result = await build({
  entryPoints: [join(root, "packages/cli/src/main.ts")],
  outfile: BUNDLE,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
  define: { __QED_LIBS__: JSON.stringify(libs) },
});

const inputs = Object.keys(result.metafile.inputs).length;
const kb = Math.round(statSync(BUNDLE).size / 1024);
process.stdout.write(`packages/cli/dist/qed.cjs: ${inputs} modules, ${kb}KB\n`);
