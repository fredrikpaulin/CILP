# Changelog

All notable changes to Copper are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Project scaffolding: directory layout, `package.json` (`copper-ilp`), MIT
  license, README, documentation stubs (overview, API, roadmap), and the
  initial backlog of tickets broken out from the architecture.
- Term language: the six structures (variable, constant, compound, atom, clause,
  program) as JSON Schema draft 2020-12, with a small schema-driven validator
  (`validate`, `isTerm`, `isAtom`, `isClause`, `isProgram`). (#001)
- Unification with occurs-check (`unify`, `walk`, `applySubstitution`) over the
  term language, with substitutions as `Map<number, Term>`. (#002)
- Background predicate registry (`makeRegistry`, `loadBackground`): predicates as
  generators or plain functions, the boundary between logic and arbitrary JS. (#004)
- SLD resolution interpreter (`interpret`): a lazy generator with implicit
  backtracking, standardize-apart clause renaming, and a depth bound. This is
  copper-core's reference interpreter. (#003)
- Variable normalization (`normalize`, `denormalize`): symbolic names to per-clause
  integer ids and back, preserving names for an exact round-trip. (#005)
- Coverage evaluation harness (`covers`, `coverage`) and the Phase 1 milestone — a
  hand-written tic-tac-toe win rule evaluated against example boards end to end. (#006)

This completes Phase 1: the pure-JS core executor (term language, unification,
resolution, background predicates, normalization) runs programs against examples.

- Problem, bias, and predicate-declaration JSON Schemas, plus `enum` support in the
  validator. (#007)
- `synthesize(problem, options?)`: validates the problem, resolves background (a
  module path, a registry, or a predicates object), and runs a budget-aware search
  loop over a pluggable enumerator, returning `{ program, coverage, stats }`.
  Surfaces `target_coverage`, `noise_tolerance`, `max_candidates`, `max_time_ms`.
  The structured enumerator that feeds it by default arrives in #008. (#007)
- Path A hypothesis enumerator (`enumerate`, `enumerateClauses`): lazily generates
  candidate programs in complexity order (clause count, body length, variable count)
  within the bias, as variable-only clauses with set-bodies in a contiguous-variable
  canonical form. Now `synthesize`'s default candidate source. (#008)
- Constraint learner (`makeConstraints`, `canonicalProgram`, `subsumes`): the four
  constraint types — `too_general` (clause-superset pruning), `too_specific`
  (theta-subsumption pruning), `unsatisfiable` (type-conflict pruning), `redundant`
  (canonical dedup). Wired into `synthesize` (on by default, `{ constraints: false }`
  to disable) with a `candidates_pruned` stat. (#009)
- Benchmark suite (`bench/`): ten ILP problems across kinship and successor-chain
  domains, two recursive. A runner (`bun bench/run.js`) reports correctness and the
  constraint-pruning reduction. All ten synthesize correctly; constraint learning
  gives a 4.9x aggregate candidate reduction (up to 22.5x on the larger problems). (#010)

This completes Phase 2: hypothesis enumeration and constraint learning. Copper now
synthesizes logic programs from examples, with pruning that scales with the search.

- Verification helpers (`verify`, `firstProof`) in copper-core: `verify` runs a program
  against positive and negative examples and returns per-example coverage with a proof
  trace for each — the ground atoms (clause heads and witnessing background facts) that
  derived each positive, and `proof: null` for anything that doesn't hold. `firstProof`
  is the single-goal primitive. Cost is proportional to the example count and proof size,
  not the search space; `covers`/`coverage` stay the proofless hot path. Pins the JSON-IR
  invariant: `synthesize` always carries the JSON `program`, and the interpreter is the
  reference semantics a lowering is checked against. (#022)
- Harness manifests (`harness.js` in copper-core): `HarnessManifest` and `PrimitiveDecl`
  JSON Schemas, plus `validateManifest`, `loadManifest`, `semanticHash`, `withHash`,
  `verifyManifest`, `checkImplementation`, and `loadHarness`. A manifest is the
  language-agnostic contract for a library of primitives — name, arity, arg types, modes,
  determinism, description, and canonical example calls. `semanticHash` is a deterministic,
  order-independent `sha256:` over the declarations (excluding version labels), so an
  implementation that records the hash it targets is rejected at load when it's stale
  against an evolved manifest. Supersedes the informal "JS functions registered by name":
  a registry is now a manifest paired with a hash-checked implementation. (#023)
- Harness conformance (`conform` in copper-core) and the first curated library
  (`libraries/lists/1.0.0/`). `conform(manifest, implementation)` runs every declared
  example call against an implementation and checks the solutions match the declared
  result (`true`/`false` for whether the call holds, or `{ solutions }` for the exact set
  of variable bindings), returning per-example pass/fail plus the primitives that declare
  no examples. The `lists` library (`cons`, `head`, `tail`, `empty`, `member` — det output
  bindings, a det test, and a nondet enumeration over cons/nil lists) ships a manifest and
  a JavaScript implementation that records the manifest hash and passes every example.
  Where the semantic hash checks identity, conformance checks behaviour; the two are
  complementary. Cross-target conformance is deferred until a second lowering exists
  (Python, #029). (#024)
- File-based library registry (`libraryRegistry` in copper-ilp/engine). Curated libraries
  are distributed as files under `<root>/<library>/<version>/` — a `manifest.json` and
  per-target implementations. The resolver provides `list`, `versions`,
  `resolveVersion` (`"latest"` → highest), `manifest`, `implementationSource`, and `load`.
  `load` is the fetch-and-verify loop end to end: read the manifest, import the
  implementation, check its recorded hash against the manifest, return a ready background
  registry — a stale implementation is rejected before any goal resolves. `root` is a
  local directory or an HTTP base URL; reading works over either, but `load` runs the
  implementation and is local-only. No publishing API, no versioning service, and no
  user-uploaded libraries in v1; the HTTP surface (`/v1/libraries`) is #027. (#025)
- Lowering framework and the JavaScript target (`lower`, `lowerJavaScript` in
  copper-core, under `src/core/lowering/`). A lowering is a pure
  `lower(program, harness, options?) => { source, metadata }`; `lower` dispatches on
  `options.target` (default `"javascript"`). The JS pass uses modes to compile clauses
  into native control flow — each head predicate becomes a generator yielding its `out`
  arguments, body goals become nested loops, recursion becomes recursive generator calls
  — and its output is verified to match the JSON interpreter solution-for-solution across
  examples (the interpreter is the reference semantics). Mandatory modes: body-predicate
  modes come from the harness, target modes from `options.modes`. The `metadata`
  feasibility report is `"ok"` / `"caveats"` (recursion: native, no depth bound) /
  `"infeasible"` (unmoded, ill-moded, or compound/non-variable arguments). Target-unaware
  only; target-biased synthesis is #032. (#026)

### Fixed

- `packTermInto` now zeroes its slot region before packing, instead of assuming
  zero-initialized memory. A fresh `ArrayBuffer` is zeroed but a recycled Metal pool
  buffer is not, so stale `child_offsets` were read as real children on the GPU path —
  surfaced by the #014 coverage parity test on Apple Silicon. (#013/#014)

- ARC transformation induction (`applications/arc/`): a grid representation, a broad
  library of grid-id-parameterized background predicates (cell, adjacency, mirrors,
  connected components, bounding boxes, counts), and a per-output-cell task framing.
  Synthesizes geometric transforms (identity, transpose) end to end on hand-built demo
  tasks; colour-specific recolouring (needs clause constants) and body-2 rules (arity-4
  search blowup) are out of the tractable subset and documented as such. (#018)

- LLM-assisted bias (C3): `llmBiasProposer` with an injected `callModel(prompt) => text`
  — `buildBiasPrompt`, `parseBiasResponse`, and schema validation of the proposed bias
  before it reaches the search. The ARC application wires it (`ARC_CATALOG`,
  `solveTaskWithProposer`) for the full hybrid loop: the model scopes the bias, Copper
  searches inside it, and a scoped bias is shown to test far fewer candidates than a
  broad one. The real model call is injected; CI uses a mock. (#019)

### Changed

- Package split into `copper-ilp/core` (universal: term language, interpreter,
  verification — no native, GPU, or Node-only dependencies) and `copper-ilp/engine`
  (Bun: enumerator, constraint learner, `synthesize`), via subpath exports under one
  `copper-ilp` package. The dependency direction is one-way (engine → core), and
  `loadBackground`'s `node:` imports are now lazy so core loads in any runtime. (#021)
- GPU infrastructure lifted from Smith (MIT, pinned to commit `d3327014`): the native
  Metal bridge (`native/copper_gpu.{h,m}`) and its Bun FFI bindings, dispatch helper,
  buffer pool, and profiler (`src/engine/gpu/`), plus `build.sh`. The async dispatch
  path and ML-specific helpers were trimmed. Built on Apple Silicon with `bash build.sh`;
  exercised by an Apple-Silicon-only smoke test, and kept out of the engine import graph
  until the ops layer (#014). (#011)
- Packing layer foundation: the slot layout (`type_tag`, `functor_id`,
  `child_offsets[maxArity]`), layout descriptors for packed terms, clauses, and
  coverage masks with JSON Schemas, and the `PackedBuffer` abstraction —
  `cpuPackedBuffer` (ArrayBuffer-backed, universal) and `poolPackedBuffer`
  (Metal-pool-backed, Apple Silicon). A typed view over a plain buffer and over a
  Metal shared buffer are interchangeable, so packing is developed and tested on
  CPU. (#012)
- Term packing (`pack.js`, `unpack.js`): `packTermInto`/`unpackTermFrom` write a JSON
  term into the slot layout (root at slot 0, children via child offsets) and reverse
  it, with an exact round-trip across the full term language. A shared symbol table
  interns functors and constants to integers; variable names canonicalize to `V{id}`.
  `packTerms` packs a batch into one buffer via an injected allocator (CPU or Metal
  pool) — a single allocation per generation, freed as a unit. (#013)
- ILP Metal shaders and dispatch wrappers: `unify_batch` (one thread per
  candidate/example pair, explicit-stack structural unification, coverage bit),
  `coverage` (one thread per example), `constraint_mask` (one thread per candidate,
  region-equality prune). Each has a CPU reference (`src/engine/ops/`) that is the
  oracle and the default backend; the GPU backend dispatches the kernel and is verified
  on Apple Silicon to match the reference bit for bit. (#014)
- Backend auto-selection (`gpuAvailable`, `resolveBackend`) and a `backend: "auto"` mode
  on the batch ops: GPU when Metal is present and the dylib is built, CPU reference
  otherwise, with identical results. A speedup harness (`bun bench/gpu_bench.js`)
  measures batched structural unification GPU-vs-CPU on a characterized workload (33x
  wall-clock, ~316x kernel-only, on an M-series Mac at 1.6 M pairs), after
  confirming bit-for-bit parity. End-to-end GPU coverage inside the synthesize search
  (which needs packable background) is tracked as #035. (#015)
