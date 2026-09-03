# 0001 - Usage-detection engine: string search, hybrid, or TypeScript AST

- Status: accepted
- Proposed: 2026-08-16
- Decided: 2026-09-03, by the maintainer
- Related: issue #142 (AST-based detection), #141 (inline documents), #144 (confidence scoring), #145 (deeper field analysis)

## Context

gqlPrune decides "used" by a whole-word string search: for each operation it derives search strings from `usagePatterns` (for example `useGetUserQuery`, `GetUserDocument`) and looks for them in the configured source tree. The same substrate powers fragments, orphaned files, and the field-candidates heuristic.

This is a deliberate design, not an accident. It is what makes the tool schema-free, dependency-light (graphql, picomatch, kleur, js-yaml, three scoped inquirer packages), fast on large trees, and honest: the README's Limitations section frames every finding as a candidate produced by a string search, to verify before deleting.

The cost is accuracy at the margins. User feedback (2026-08-16) ranks this as the second most wanted improvement: names assembled dynamically, re-exports, generated barrels, and renamed bindings can all make a used operation look unused, and the whole-word check cannot see through any of them.

The competitive picture comes from the survey in [docs/research/competitive-landscape-2026-08.md](../research/competitive-landscape-2026-08.md), which carries the sources and figures behind these statements. The only tool that took the AST route for this exact problem, @ovrsea/graphql-detect-unused-operations (ts-morph based), is archived with negligible downloads, and it also required a schema. GraphQLSP is type-aware but schema-bound and same-file scoped. No maintained tool combines schema-free operation with static whole-repo scanning; that combination is currently gqlPrune's unchallenged position.

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

Option 3: the string-search engine is replaced by TypeScript AST-based usage detection. The maintainer chose it on 2026-09-03; the author's recommendation at proposal time was option 2, recorded here because the trade-off was real and may be revisited if the dependency cost proves too high in practice.

The schema-free property is kept. Nothing in the decision requires a schema; the AST engine reads the client code, not the API.

## Consequences

What the new engine covers, and what falls outside it:

| Area | After this decision |
| --- | --- |
| GraphQL documents | `.gql` and `.graphql` files keep being parsed with graphql-js. The engine change is on the usage side only. |
| Source files | `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, parsed with the TypeScript compiler API. Imports, re-exports, barrel files and renamed bindings are resolved before an operation is judged. |
| Single-file components | Vue, Svelte and Astro files are out of scope for the first engine. They are not scanned, and the README says so. |
| Inline documents (#141) | The hand-written lexical scanner is superseded by real parsing of tagged templates and helper calls. Its two invariants stay: a document is never its own usage, and a definition constant never satisfies a usage pattern. |
| `usagePatterns` | Still mean "which identifiers count as usage". The engine resolves those identifiers to their declarations instead of grepping for the text. |
| Confidence (#144) | Grades are re-based on AST evidence. The `source-mention` reason disappears, since the engine knows whether a mention is a reference. |
| Fragments and orphaned files | Unchanged in meaning; they consume the same usage verdicts. |
| Dependencies | `typescript` becomes a runtime dependency. The README's dependency and speed claims are rewritten around the new engine, and the candidates framing is softened to match what the engine can now prove. |
| Fields (#145) | The precise variant, tracing property reads on query-result types, becomes possible. |

Follow-ups this decision creates:

- #142 is rescoped to "replace the engine" with the table above as its scope; the option 2 flag design is dropped.
- The README, `docs/architecture.md` and the Limitations section are updated when #142 lands, not before.
- Performance on large trees is measured before and after, and the result is recorded in #142.
