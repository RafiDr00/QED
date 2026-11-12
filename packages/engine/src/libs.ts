import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

/**
 * The standard library declarations the type checker reads.
 *
 * Generating from a parameter's *type* rather than from how it is written
 * needs the checker, and the checker needs `lib.es2022.d.ts` and the files it
 * references to know what `Date`, `Partial` or `Record` mean. Under `tsx` they
 * are read from the installed `typescript` package. The single binary has no
 * package on disk, so `scripts/build-cli.ts` embeds the same files as
 * `__QED_LIBS__` at build time.
 */

declare const __QED_LIBS__: Readonly<Record<string, string>> | undefined;

/** The lib every program is checked against. */
export const ROOT_LIB = "lib.es2022.d.ts";

const embedded: Readonly<Record<string, string>> | undefined =
  typeof __QED_LIBS__ === "undefined" ? undefined : __QED_LIBS__;

let libDir: string | undefined;

/** The text of one lib file, by its file name, or undefined if there is none. */
export function libText(name: string): string | undefined {
  if (embedded !== undefined) return embedded[name];
  libDir ??= dirname(ts.getDefaultLibFilePath({}));
  try {
    return readFileSync(join(libDir, name), "utf8");
  } catch {
    return undefined;
  }
}

/** `ROOT_LIB` and every lib it references, transitively. For the build. */
export function libClosure(read: (name: string) => string | undefined = libText): Record<string, string> {
  const out: Record<string, string> = {};
  const queue = [ROOT_LIB];
  while (queue.length > 0) {
    const name = queue.pop();
    if (name === undefined || name in out) continue;
    const text = read(name);
    if (text === undefined) throw new Error(`missing lib file ${name}`);
    out[name] = text;
    for (const match of text.matchAll(/<reference lib="([^"]+)"/g)) {
      queue.push(`lib.${match[1] ?? ""}.d.ts`);
    }
  }
  return out;
}
