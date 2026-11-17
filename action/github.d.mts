/** Types for github.mjs, which runs without a build step. */

export declare const MARKER: string;

export interface ReportForAnnotations {
  readonly result: {
    readonly runs: readonly {
      readonly path: string;
      readonly symbol: string;
      readonly line?: number;
      readonly via?: string;
      readonly verdict:
        | { readonly state: "EQUIVALENT" }
        | { readonly state: "ABSTAINED"; readonly obstruction: string }
        | {
            readonly state: "DIVERGED";
            readonly counterexample: {
              readonly input: string;
              readonly base: string;
              readonly head: string;
              readonly repro: string;
              readonly affects?: string;
            };
          };
    }[];
  };
}

export declare function annotations(report: ReportForAnnotations): string[];

export declare function upsertComment(options: {
  readonly api: string;
  readonly repository: string;
  readonly issue: number;
  readonly token: string;
  readonly body: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<string>;
