# Overview

Copper synthesizes logic programs from examples. This document explains how the pieces fit together. For the callable surface, see [api.md](api.md); for what's planned, see [roadmap.md](roadmap.md).

## what it does

You give Copper a *problem*: a small set of positive examples, a set of negative examples, some background knowledge, and a *bias* describing the shape of program you'll accept. Copper searches for a program that entails every positive, no negative, and stays within the bias. It returns the program, a coverage proof, and search statistics.

The whole problem is one JSON object, and the whole result is one JSON object. There is no Prolog file format and no separate query language to learn.

## the layers

Copper is three layers of its own, sitting on a GPU infrastructure layer adapted from Smith, sitting on Metal.

**The clause executor** runs a restricted logic language: definite Horn clauses, no cuts, no `assert`/`retract`, no meta-programming, bounded recursion depth. It is built from three classical pieces — unification with occurs-check, SLD resolution implemented as a lazy generator, and a registry of background predicates. Background predicates are ordinary JavaScript functions (or generators, for non-deterministic ones). A predicate can be pure logic over the term language, or it can call out to a parser, a database, or the network. The wall Prolog puts between "logic" and "foreign code" isn't there.

**The hypothesis enumerator** generates candidate programs that respect the bias, in order of increasing complexity. The default path is a pure-JavaScript enumerator; a second path encodes the search as Answer Set Programming for larger biases. Both feed the same downstream pipeline — the choice is configuration, not a fork in the architecture.

**The constraint learner** is what keeps the search tractable. When a candidate fails, Copper derives a constraint explaining *why* it failed and uses that constraint to prune every related candidate at once: hypotheses that are too general, too specific, internally unsatisfiable, or redundant with one already seen.

## the GPU layer

The bias bounds — maximum depth, maximum arity, maximum clause count — make candidate programs packable into fixed-shape buffers. That's the lever the GPU layer pulls. Terms are packed into flat typed buffers, and a Metal compute shader evaluates one `(candidate, example)` pair per thread, writing a coverage bit. The same bounds that constrain the search also fix the buffer layout, so the packing is known statically.

The GPU layer is a speedup, not a requirement. Copper runs CPU-only on any platform Bun supports. The Metal acceleration is Apple Silicon only.

## the term language

Everything Copper reasons about is a plain JSON object that validates against a JSON Schema: variables, constants, compound terms, atoms, clauses, and whole programs. Variables carry symbolic names for readability and are mapped to integer IDs at the executor boundary for speed, then restored on output. The full set is small — six structures — and every value round-trips through JSON.

## entry points

The package splits along the universal/engine line. `copper-ilp/core` is the universal layer — term language, JSON interpreter, verification — with no native, GPU, or Node-only dependencies; it loads in any JavaScript runtime. `copper-ilp/engine` adds the synthesis engine and depends on core. The dependency direction is one-way: core never imports engine, which is what keeps core universal. The default `copper-ilp` import is the full system.

## platform

The core layer is pure JavaScript and runs anywhere. The engine runs on Bun, and the GPU acceleration (once it lands) requires Metal, and therefore Apple Silicon. Requires Bun >= 1.2.0 for the engine.
