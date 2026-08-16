# 0001 - Usage-detection engine: string search, hybrid, or TypeScript AST

- Status: proposed
- Date: 2026-08-16
- Decider: maintainer
- Related: issue #142 (AST-based detection), #141 (inline documents), #144 (confidence scoring), #145 (deeper field analysis)

## Context

gqlPrune decides "used" by a whole-word string search: for each operation it derives search strings from `usagePatterns` (for example `useGetUserQuery`, `GetUserDocument`) and looks for them in the configured source tree. The same substrate powers fragments, orphaned files, and the field-candidates heuristic.

This is a deliberate design, not an accident. It is what makes the tool schema-free, dependency-light (graphql, picomatch, kleur, js-yaml, three scoped inquirer packages), fast on large trees, and honest: the README's Limitations section frames every finding as a candidate produced by a string search, to verify before deleting.

The cost is accuracy at the margins. User feedback (2026-08-16) ranks this as the second most wanted improvement: names assembled dynamically, re-exports, generated barrels, and renamed bindings can all make a used operation look unused, and the whole-word check cannot see through any of them.

The competitive picture, from the verified 2026-08-15 survey: the only tool that took the AST route for this exact problem, @ovrsea/graphql-detect-unused-operations (ts-morph based), is archived with negligible downloads, and it also required a schema. GraphQLSP is type-aware but schema-bound and same-file scoped. No maintained tool combines schema-free operation with static whole-repo scanning; that combination is currently gqlPrune's unchallenged position.

## Options

### 1. Stay with pure string search

Keep the engine as is and route accuracy work through confidence scoring (#144), which can grade findings by signal quality without changing how signals are gathered.

Consequences: zero new dependencies, no performance change, positioning untouched. The accuracy ceiling is permanent and documented; the feedback item is declined rather than deferred.

### 2. Hybrid: string search by default, opt-in AST resolution

The default scan stays exactly as today. An opt-in mode (for example `--ast`) parses TS/JS sources and resolves imports, re-exports, barrel files, and renamed bindings before usage is judged, so an operation referenced only through indirection is still found, and a string hit that is only a same-named unrelated identifier can be discounted.

Consequences: the schema-free, fast, zero-config default survives as the product's identity, and the precise mode becomes a choice with a visible cost. Two engines must agree on semantics and both need tests. The dependency question must be settled: the TypeScript compiler API as an optional peer dependency keeps the default install light, at the price of a "works only if typescript is installed" mode. Output framing needs care so AST-mode findings do not silently claim more certainty than they have; #144's confidence grades are the natural vehicle.

### 3. Full AST engine

Replace the string search outright.

Consequences: best accuracy and one engine to maintain, but the default install gains a heavy dependency, cold scans slow down, plain-JS and template-language projects get worse coverage than today, and the README's positioning (including the candidates framing and the speed claim) must be rewritten around a different product.

## Decision

Proposed, not yet decided. The author's recommendation is option 2: it converts the feedback into a feature without spending the differentiator, and it sequences naturally after #141, since scanning inline documents already requires walking TS/JS source and makes the incremental cost of real parsing much smaller.

## Consequences of accepting option 2 (to be confirmed)

- #142 becomes "implement the opt-in AST mode" with the dependency decision (typescript as optional peer) recorded here.
- #145's precise variant (tracing property reads on result types) becomes possible inside the AST mode only.
- The README gains a section describing both modes and their trade-offs; the default mode's documentation does not change.
