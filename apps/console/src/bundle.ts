import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { parseBundle, runsOf, type BundleRun, type QedBundle } from "@qed/ui";

import { EXAMPLE_BUNDLE } from "./bundle.generated.js";

/**
 * What the console is showing: a bundle, and where it came from.
 *
 * The console used to render typed-in fixtures - a release history nobody
 * ran, a Rekor index nobody logged. It now renders a bundle: by default the
 * one `pnpm generate:run` builds from a real engine run over examples/ledger,
 * or one a reader opens from disk. Both go through `parseBundle`, the same
 * door, and nothing leaves the browser.
 */

export interface Loaded {
  /** "the example run", or the file's name. */
  readonly source: string;
  readonly example: boolean;
  /** The bytes as loaded, so the digest and the download are of exactly these. */
  readonly text: string;
  readonly bundle: QedBundle;
  /** Newest first. */
  readonly runs: readonly BundleRun[];
}

function load(text: string, source: string, example: boolean): Loaded | string {
  const parsed = parseBundle(text);
  if (!parsed.ok) return parsed.problem;
  return { source, example, text, bundle: parsed.bundle, runs: runsOf(parsed.bundle) };
}

const example = load(EXAMPLE_BUNDLE, "the example run", true);
if (typeof example === "string") {
  // The build wrote it; if it does not parse, the build is wrong, not the reader.
  throw new Error(`The example bundle does not parse: ${example}`);
}
const EXAMPLE: Loaded = example;

export interface BundleState {
  readonly loaded: Loaded;
  /** Why the last file offered was refused, if it was. */
  readonly refusal: string | undefined;
  readonly open: (file: File) => Promise<void>;
  readonly reset: () => void;
}

export function useBundleState(): BundleState {
  const [loaded, setLoaded] = useState<Loaded>(EXAMPLE);
  const [refusal, setRefusal] = useState<string | undefined>();

  const open = useCallback(async (file: File) => {
    const result = load(await file.text(), file.name, false);
    if (typeof result === "string") {
      setRefusal(`${file.name} was not opened. ${result}`);
      return;
    }
    setRefusal(undefined);
    setLoaded(result);
  }, []);

  const reset = useCallback(() => {
    setRefusal(undefined);
    setLoaded(EXAMPLE);
  }, []);

  return useMemo(() => ({ loaded, refusal, open, reset }), [loaded, refusal, open, reset]);
}

export const BundleContext = createContext<BundleState | undefined>(undefined);

export function useBundle(): BundleState {
  const state = useContext(BundleContext);
  if (!state) throw new Error("useBundle outside the console shell");
  return state;
}

/** The run the Run, Verdicts and Attestations views show: the newest. */
export function latestRun(loaded: Loaded): BundleRun {
  const [run] = loaded.runs;
  // parseBundle refuses a bundle with no records, so there is always one.
  if (!run) throw new Error("a parsed bundle with no run");
  return run;
}
