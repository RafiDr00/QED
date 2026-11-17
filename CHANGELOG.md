# Changelog

Every change that alters what `qed` does, what it claims, or what a record
contains. The version a record names as its engine is the one in
`packages/cli/package.json`, and a release tag must match it.

## 0.3.0 (unreleased)

Records can now say who ran them, in a way anyone can check without asking us.

- `qed check --sign` signs the run with Sigstore under the CI job's own OIDC
  identity and logs it in Rekor. Each record's `signer` and `rekorIndex` name
  the certificate's identity and the log entry. One signature covers the run.
- `qed verify` checks a signed record's certificate chain, signature and
  Rekor inclusion proof offline, against a Sigstore trusted root built into
  the binary. `--signer` requires an exact signing identity.
  `--trusted-root` takes a newer root.
- A signed record fails verification when it is edited after signing, when
  its signer is rewritten, or when its log index is moved, even with a
  recomputed digest.
- Release checksums are signed with cosign. `install.sh` checks the signature
  when cosign is installed, and `QED_REQUIRE_SIGNATURE=1` refuses to install
  without that check.
- A new workflow signs a real run on every push and verifies it with the
  network switched off.

## 0.2.0 (2026-11-12)

QED now verifies the shapes ordinary TypeScript is written in, and checks
itself. Every case is in `tests/unit/coverage.test.ts`.

- Parameter types are resolved by the TypeScript checker. Imported interfaces,
  `Partial`, `Pick`, `Omit`, `Record`, intersections, branded numbers, `Date`,
  `Map`, `Set`, typed arrays, readonly arrays, template literal types and
  constrained type parameters all generate. A refusal names where in the
  parameter it happened.
- Callbacks generate. A callback records its calls, and the calls are compared
  along with the result.
- `export { a, b as c }` and `export default` are verified. A default export
  appears as `default`.
- A package import blocks only the functions that use it.
- `qed check` verifies unchanged files that import a changed one, marked
  `via <file>`. Constants are mined from pinned imports too.
- Imports written as `./file.js` resolve to `file.ts`. `.tsx` modules load.
- A function that never returns abstains after a minute instead of hanging
  the run.
- An async function that rejects no longer crashes the run.
- The description of where a change bites names only values the code names,
  and needs at least three diverging inputs.
- Gate G11: QED verifies every exported function in its own packages against
  itself. None may diverge, and the count verified may not fall.
- Repeated `git show` calls for imports are gone. A check over a changed
  helper went from two minutes to under a second.

## 0.1.0 (2026-11-12)

The first release: the engine, the CLI, the records, and the surfaces that
show them.

### The engine

- Runs both versions of every changed exported function in a `node:vm`
  sandbox with the clock frozen, `Math.random` seeded, network and timers
  denied, and relative imports pinned to the revision being compared. Package
  and built-in imports are refused by name.
- Generates inputs from the declared parameter types, seeded with the
  constants mined out of both versions so a moved boundary is found on the
  first run rather than by luck. Edge values run before any random draw.
- Decides purity by running the function: twice on one module state, then
  under a second clock and seed. A function that moves abstains with the
  control that moved it.
- Compares outcomes structurally. Object key order is not a difference,
  array order is, NaN agrees with NaN, +0 and -0 do not. Classes are compared
  by name as well as by fields. Every tolerance applied is recorded, on an
  equivalence as well as on a divergence.
- Minimises a diverging input before printing it, and describes where the
  change bites: "Diverges exactly when `qty` is at least 100 and `tier` is
  "gold". That is 6.2% of generated inputs."
- Encodes counterexamples losslessly, so NaN, -0, Infinity, BigInt, Dates,
  Maps and Sets survive the repro line.

### Soundness

Each of these was a pair of functions that behave differently and that QED
certified EQUIVALENT. All are covered by `tests/unit/soundness.test.ts`.

- Maps, Sets, RegExps, Errors, ArrayBuffers and boxed primitives built inside
  the sandbox are compared by what they hold. They used to compare as empty
  objects, because the sandbox's built-ins are not this process's.
- Getters on user-written classes and enumerable symbol keys are compared.
  Private `#fields` cannot be read, and a comparison that leaned on that says
  so in the record.
- A function reaching for a global the sandbox does not provide abstains and
  names it. `crypto` and `performance` are denied. `TextEncoder`, `URL`,
  `structuredClone` and the other deterministic web globals are provided.
- A denied call the code catches is still an obstruction.
- A function that throws on every generated input abstains. An equivalence
  that partly rests on errors says how many threw.
- A result holding a function, a promise or a weak collection abstains and
  says where, instead of giving a false reason.

### The CLI

- `qed check [--base <ref>] [--inputs <n>] [--tolerance float=<e>,rel=<e>]
  [--records <dir>] [--no-color]` reads the diff from git, verifies every
  exported function the two versions share, and writes one record per
  function to `.qed/records/`, named by digest. Every digest is printed on
  stderr so the run's log holds a copy the records cannot rewrite.
- `qed repro <file> <symbol> --input '<json-array>'` runs one input through
  both versions, loading them exactly as `check` did.
- `qed verify --digest <sha256>` re-derives a record's digest from its own
  fields and compares it with the one held. A digest may be abbreviated to
  16 hex characters.
- Exit codes: 0 nothing diverged, 1 something diverged (or a record was
  altered), 2 the run could not start or finish. Unknown flags, malformed
  values and missing refs all exit 2 rather than running a check nobody asked
  for.
- Records say what is not built: `signer` reads `unsigned` and `rekorIndex`
  reads `not logged`. A run over uncommitted edits names its commit
  `<sha>+uncommitted`.
- Ships as one binary per platform, a Node single-executable application,
  built and smoke-tested on each platform by `release.yml` and installed by
  `install.sh` only after its SHA-256 matches the release's `SHA256SUMS`.

### The surfaces

- A component library built from the QED design system, with every place
  the system contradicts itself recorded in `DECISIONS.md`.
- A marketing site prerendered to static HTML, shipping under 1KB of script,
  whose every number comes from a real engine run over `examples/ledger`.
- A console demo with the run, the verdicts, the attestations and the audit
  export, where "Verify independently" recomputes the record's digest.
- `pnpm verify`: ten machine-checked gates covering contrast, token purity,
  the 4px grid, logo fidelity, mark optics, theme parity, verdict integrity,
  accessibility, bundle budget and print. The README lists what each one
  does not catch.
