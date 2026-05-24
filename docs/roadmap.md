# Roadmap

Copper is built in phases, each ending with something that works. Version numbers below are targets, not promises about dates.

## 0.1 — core executor

Pure JavaScript, no GPU. The clause executor end to end: the term language and its JSON Schemas, unification with occurs-check, SLD resolution as a lazy generator, background predicate registration, and the test harness. Milestone: evaluate a hand-written rule against examples end to end.

## 0.2 — enumeration and constraint learning

Still CPU-only. The structured hypothesis enumerator (Path A), the four constraint types (`too_general`, `too_specific`, `unsatisfiable`, `redundant`), and the integration loop that feeds derived constraints back into the search. Milestone: family-tree and string-transformation benchmarks pass, correctness matches a reference learner across a small suite, and constraint learning shows measurable pruning against naive enumeration.

## 0.3 — GPU acceleration

The headline result. Adapt the GPU infrastructure from Smith, build the packing layer that flattens terms into fixed-shape buffers, and write the three Metal shaders — batched unification, full coverage, and constraint masking — with their dispatch wrappers. Wire them into the search hot loop. Milestone: a measured speedup over the 0.2 CPU baseline, reported with honest workload characterization.

## 0.4 — Path B (ASP / Clingo)

Conditional. For biases too large for structured enumeration, encode the hypothesis space as Answer Set Programming and shell out to Clingo. This ships only if the applications need bigger biases than CPU-plus-GPU enumeration handles comfortably; otherwise it defers.

## 0.5 — applications

Two applications on the same core. Bug-pattern detection for Oracle Forms → JS migration: AST background predicates over PL/SQL and converted JavaScript, evaluated against a real migration corpus, with the goal of discovering new patterns rather than only recovering known ones. ARC-AGI-3 transformation induction: a predicate library over grids, regions, and objects, scored on the public eval set.

## 1.0 — stable

A documented, benchmarked, importable Bun module with a settled `synthesize` contract.

## future considerations

Beyond 1.0, the design deliberately leaves room for:

- **Predicate invention** — synthesizing auxiliary predicates the user didn't declare. The hardest part of modern ILP, deferred from v1 but left as a v2 extension point in the bias schema.
- **Non-ground examples** — examples with universally-quantified variables. More expressive, harder to test against; v1 is ground-only.
- **Softer noise tolerance** — the strict "cover all positives, no negatives" criterion will not survive contact with real migration data. A `noise_tolerance` parameter lets the constraint learner count misclassifications rather than gate on them.
- **Per-bias pack tuning** — a fixed conservative pack-slot size handles most problems; outliers get an escape hatch to recompile shaders for their bias.
- **LLM-assisted bias synthesis** — an LLM proposes the bias from a natural-language description plus examples; Copper performs the rigorous search inside it. The split is soft "what shape of program" for the LLM, hard "find one provably correct" for Copper.
