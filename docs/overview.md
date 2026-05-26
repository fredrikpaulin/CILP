# Overview

Copper synthesizes logic programs from examples. This document explains how the pieces fit together. For the callable surface, see [api.md](api.md); for what's planned, see [roadmap.md](roadmap.md).

## what it does

You give Copper a *problem*: a small set of positive examples, a set of negative examples, some background knowledge, and a *bias* describing the shape of program you'll accept. Copper searches for a program that entails every positive, no negative, and stays within the bias. It returns the program, a coverage proof, and search statistics.

The whole problem is one JSON object, and the whole result is one JSON object. There is no Prolog file format and no separate query language to learn.

## the JSON program is the source of truth

The synthesized program is a JSON object, and that form is canonical: everything else — proof traces, lowered source code in other languages — is a projection of it. Verification is defined against the JSON program by re-running it on the examples, which is cheap (proportional to the example count, not the search space). A lowering to JavaScript, Python, SQL, or C is correct exactly when it behaves like the JSON interpreter on the same examples; a disagreement is a lowering bug, not a synthesis bug. "Verified" means *covers these examples and excludes these counter-examples* — not "correct on unseen inputs."

## the layers

`copper-ilp/core` is the universal layer — the term language, the JSON program interpreter, verification, and harness manifests — with no native, GPU, or Node-only dependencies, so it loads in any JavaScript runtime. `copper-ilp/engine` adds the synthesis engine and runs on Bun. The dependency direction is one-way: core never imports engine, which is what keeps core universal. The default `copper-ilp` import is the full system.

**The clause executor** (core) runs a restricted logic language: definite Horn clauses, no cuts, no `assert`/`retract`, no meta-programming, bounded recursion depth. It is built from three classical pieces — unification with occurs-check, SLD resolution implemented as a lazy generator, and a registry of background predicates. Background predicates are ordinary JavaScript functions (or generators, for non-deterministic ones). A predicate can be pure logic over the term language, or it can call out to a parser, a database, or the network. The wall Prolog puts between "logic" and "foreign code" isn't there. The recursion bound counts how many times a single predicate may be simultaneously active along a derivation path, so a long non-recursive body is never cut short — only genuine recursion is bounded.

**The hypothesis enumerator** (engine) generates candidate programs that respect the bias, in order of increasing complexity (clause count, body length, variable count), as variable-only clauses. This structured "Path A" enumerator is the default and only candidate source today; a second path that encodes the search as Answer Set Programming, for biases too large for structured enumeration, is a conditional future addition rather than something that ships now.

**The constraint learner** (engine) keeps the search tractable. When a candidate fails, Copper derives a constraint explaining *why* and uses it to prune every related candidate at once: hypotheses that are too general, too specific (θ-subsumption), internally unsatisfiable, or redundant with one already seen. θ-subsumption pruning assumes a more-general clause covers everything a more-specific one does — true for relational predicates but not for *moded* ones that fail on unbound input — so it is disabled when the bias declares input modes, where that assumption would delete correct programs.

## the GPU layer

The bias bounds — maximum depth, arity, clause count — make candidate programs packable into fixed-shape buffers, and that is the lever the GPU layer pulls. Terms are packed into flat typed buffers and a Metal compute shader performs batched structural unification, one `(candidate, example)` pair per thread. Each kernel has a CPU reference that is its oracle; the GPU backend is verified to match it bit for bit, and a backend auto-selects (GPU when Metal is present, CPU reference otherwise) with identical results. On an M-series Mac the structural-unification kernel runs about two orders of magnitude faster than the CPU reference on a characterized workload.

What the GPU accelerates is structural unification, not coverage in general: coverage with background predicates is full SLD resolution and stays on the CPU. The one coverage regime that *is* structural unification — body-less (fact) clauses — can route through the packed representation, and synthesize takes a pluggable coverage evaluator so that path can be wired in; everything else uses the CPU interpreter. The GPU layer is a speedup, not a requirement: Copper runs CPU-only on any platform Bun supports, and the Metal acceleration is Apple Silicon only.

## harnesses: manifests, conformance, and the registry

Background knowledge is formalized as a **harness manifest** — a language-agnostic JSON document declaring each primitive's name, arity, arg types, modes, determinism, a description, and canonical example calls. A `semantic_hash` over the declarations lets an implementation detect at load time that it was built against a different version of the manifest, before a stale implementation miscompiles. The manifest is the contract; per-target *implementations* (a JavaScript module, a Python module, a C file) realize it, and the manifest's example calls double as a **conformance suite** — every implementation must agree on them. Curated libraries are distributed as files under `<library>/<version>/`, and a registry resolves and loads them, verifying the hash before handing back a runnable background. So a registry is no longer a bare bag of functions but a manifest paired with a hash-checked, conformance-tested implementation.

## lowering to other languages

A lowering is a pure function from a JSON program to target-language source, checked against the interpreter as reference semantics. Four targets ship. JavaScript and Python compile each clause into a mode-directed generator — modes turn a relation into a function, so unification becomes native control flow. SQL compiles a program to relational queries (a clause is a join, recursion a `WITH RECURSIVE` CTE). C goes furthest: with no runtime, unification is compiled fully away into `bool` functions over a term value model, which is why it demands complete modes and determinism. Each lowering returns a feasibility report — *lowered cleanly*, *lowered with caveats*, or *could not lower because Y* — rather than emitting wrong code, and because every target is checked against the same interpreter, the targets agree with one another. By default lowering is target-unaware (synthesize, then lower); a declared target can also bias the search toward programs that lower cleanly to it.

## the synthesis server

The engine ships an HTTP server (`Bun.serve`) exposing synthesis as a service for agents that can't run the engine locally. Synthesis is asynchronous by default — submit a job, poll or subscribe — with a `Prefer: respond-sync` fast path and a Server-Sent-Events stream of best-so-far results. The response always carries the JSON program, plus a per-example proof, any requested lowerings, a harness summary, and stats. The agent supplies the bias and examples; a named curated library supplies the hash-verified background, so an agent never ships executable code to the server. Lowered source is cached (it's a pure function of the program, options, harness, and lowering version). Authentication, rate limiting, and durable storage are deployment concerns, out of scope for the engine.

## the term language

Everything Copper reasons about is a plain JSON object that validates against a JSON Schema: variables, constants, compound terms, atoms, clauses, and whole programs. Variables carry symbolic names for readability and are mapped to integer ids at the executor boundary, then restored on output. The full set is small — six structures — and every value round-trips through JSON.

## platform

The core layer is pure JavaScript and runs anywhere. The engine runs on Bun, and the GPU acceleration requires Metal, and therefore Apple Silicon. Requires Bun >= 1.2.0 for the engine.
