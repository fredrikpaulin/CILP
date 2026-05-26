# Roadmap

Copper is built in phases, each ending with something that works. Version numbers below are targets, not promises about dates. Phases through the v1.1 dual-format arc have shipped; what remains is noted at the end.

## 0.1 — core executor ✓ shipped

Pure JavaScript, no GPU. The clause executor end to end: the term language and its JSON Schemas, unification with occurs-check, SLD resolution as a lazy generator, background predicate registration, and the test harness. Milestone met: a hand-written rule evaluated against examples end to end.

## 0.2 — enumeration and constraint learning ✓ shipped

Still CPU-only. The structured hypothesis enumerator (Path A), the four constraint types (`too_general`, `too_specific`, `unsatisfiable`, `redundant`), and the integration loop that feeds derived constraints back into the search. Milestone met: family-tree and string-transformation benchmarks pass, and constraint learning shows measurable pruning against naive enumeration.

## 0.3 — GPU acceleration ✓ shipped

The GPU infrastructure adapted from Smith, the packing layer that flattens terms into fixed-shape buffers, and the three Metal shaders — batched unification, full coverage, and constraint masking — each with a CPU reference oracle and a backend that auto-selects. Milestone met: a measured ~33× wall-clock (and ~316× kernel-only) speedup over the CPU baseline on a characterized workload, reported with honest workload characterization and the note that packing, not unification, is now the device-path bottleneck.

## 0.5 — applications (partial)

ARC transformation induction shipped: a grid predicate library and a per-output-cell framing that synthesizes geometric transforms (identity, transpose) end to end, with the engine's edges — variable-only space, arity blowup — mapped precisely rather than hidden. An LLM-assisted-bias seam (the model scopes the bias, Copper searches it, the bias is schema-validated) shipped with a mock model. Bug-pattern detection for Oracle Forms → JS migration is **paused**, pending a real migration corpus and connector access.

## 1.0 — stable

A documented, benchmarked, importable Bun module with a settled `synthesize` contract.

## 1.1 — dual-format output and remote synthesis ✓ shipped

The Appendix A arc: the JSON program as canonical IR with verification helpers and per-example proof traces; harness manifests with semantic hashing, per-target conformance, and a file-based library registry; a lowering framework with four targets (JavaScript, Python, SQL, C), each checked against the interpreter, with feasibility reports and cross-target agreement; target-biased synthesis; an HTTP synthesis server (async jobs, a sync fast path, SSE streaming) with lowering caching. Two core refinements landed alongside: a true per-predicate recursion-depth bound, and a persistent substitution that removes the per-bind copy.

## what remains

- **Path B (ASP / Clingo)** — conditional. For biases too large for structured enumeration, encode the hypothesis space as Answer Set Programming and shell out to Clingo. Ships only if the applications need bigger biases than CPU-plus-GPU enumeration handles; the `last/2` reachability limit (a two-clause recursive program the naive enumerator can't reach in budget) is the kind of pressure that would justify it.
- **Bug-pattern detection** — paused, as above; needs a migration corpus and connector access.
- **GPU coverage inside the search** — the structural (fact) subset can route through the packed path today; batched GPU dispatch in the search loop and SLD-with-background on the GPU (a datalog-join-on-GPU effort) are deferred.
- **The field-agent layer** — the remote agents that consume the synthesis server: routing between local and remote synthesis, harness fetching and verification on the agent side, and how synthesizable problems are recognized in the first place. Specified in the field-agent design document; out of scope for the engine itself.

## future considerations

Beyond the above, the design deliberately leaves room for:

- **Predicate invention** — synthesizing auxiliary predicates the user didn't declare. The hardest part of modern ILP, left as a v2 extension point in the bias schema.
- **Non-ground examples** — examples with universally-quantified variables. More expressive, harder to test against; v1 is ground-only.
- **Softer noise tolerance** — the strict "cover all positives, no negatives" criterion will not survive contact with real migration data; `noise_tolerance` already lets the learner count misclassifications rather than gate on them, and richer noise models would build on that.
- **Per-bias pack tuning** — a fixed conservative pack-slot size handles most problems; outliers get an escape hatch to recompile shaders for their bias.
- **Term construction in the C target** — the C lowering covers the deterministic deconstruction subset; constructing terms needs an explicit memory story, which the embedded forcing case (a microcontroller motor controller) would dictate.
