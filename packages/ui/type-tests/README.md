# Type tests

Each `*.invalid.tsx` here must fail to compile, and each `*.valid.tsx` must
compile cleanly. `scripts/type-tests.ts` runs them one file at a time and
writes the result to `.verify/type-tests.json`, which gate G7 reads.

The point is the first rule in the design system: no claim without its
evidence. These files are the proof that an evidence-free verdict is not
merely discouraged - it does not exist in the type system.
