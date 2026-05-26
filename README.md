# Copper

A Bun-native, Metal-accelerated Inductive Logic Programming system.

Copper synthesizes logic programs from a handful of examples plus background knowledge. Given positive and negative examples, it searches for a program that covers all the positives, none of the negatives, and comes with a proof of exactly which examples it entails. The output is a rule you can read, version, and run — not a probability.

Inductive Logic Programming has lived almost entirely in Prolog. Copper is built from scratch in a mainstream runtime: its own clause executor, its own hypothesis search, and a Metal compute layer that runs the inner evaluation loop on the GPU. No Prolog dependency, no Python bridge.

The name is a small joke: copper is more inductive than silver, and more useful.

> **Status:** pre-1.0, but substantially built. The clause executor, hypothesis search with constraint learning, the GPU layer, verification with proof traces, harness manifests with conformance and a library registry, lowering to four targets (JavaScript, Python, SQL, C), and an HTTP synthesis server all run and are tested. The surface can still shift before 1.0; the [roadmap](docs/roadmap.md) marks what's shipped and what remains.

## install

```sh
bun add copper-ilp
```

The package has two entry points. `copper-ilp/core` is the universal layer — the term language, the JSON program interpreter, and verification — with no native, GPU, or Node-only dependencies, so it runs in any JavaScript runtime (browser, Workers, Deno, embedded). `copper-ilp/engine` adds the synthesis engine (enumeration, constraint learning, `synthesize`) and runs on Bun. The default `copper-ilp` import is the full system.

```js
import { interpret, coverage } from "copper-ilp/core"   // universal: run and verify programs
import { synthesize } from "copper-ilp/engine"          // Bun: synthesize them
```

## quick start

```js
import { synthesize } from "copper-ilp"

const problem = {
  bias: {
    head_predicates: [{ name: "target", arity: 2, arg_types: ["any", "any"], mode: ["in", "out"] }],
    body_predicates: [{ name: "succ", arity: 2, arg_types: ["any", "any"], mode: ["in", "out"] }],
    max_clauses: 2,
    max_body_length: 3,
    max_variables: 4,
    max_recursion_depth: 3,
    allow_recursion: true
  },
  background: "./background.js",   // exports { predicates: {...} }
  positives: [/* ground example atoms */],
  negatives: [/* ground example atoms */]
}

const solution = await synthesize(problem)
// solution = { program, coverage, stats }
console.log(solution.program)
```

A problem is a single JSON object. The synthesizer returns the program it found, the coverage proof, and search statistics.

For a runnable end-to-end example, `bun run demo` synthesizes `second/2` (the second element of a list) over a small list library and verifies the result by executing it against the examples, printing a proof trace for each.

## why Copper

The argument for ILP over an LLM is leverage. An LLM that says "this looks buggy" gives you nothing to hold onto. A synthesized rule — "any fragment matching pattern P is wrong when it lacks property Q" — is a check you can run deterministically across an entire codebase, inspect, and unit-test. ILP produces programs that are provably correct on the given examples, interpretable, and recursive when the problem needs it.

Copper exists to make that machinery available outside the Prolog ecosystem, embeddable in a JS/TS agent stack, and fast enough to be useful via GPU-batched hypothesis evaluation.

## platform support

The core executor and hypothesis search are pure JavaScript and run anywhere Bun runs (`darwin`, `linux`). The GPU acceleration layer is Metal-only and therefore Apple Silicon. Copper runs CPU-only without it; the GPU layer is a speedup, not a requirement.

Requires Bun >= 1.2.0.

## documentation

- [Overview](docs/overview.md) — how the system fits together
- [API reference](docs/api.md) — `synthesize`, the problem schema, the term language
- [Harness manifests](docs/harness.md) — background contracts, conformance, the library registry
- [Lowering](docs/lowering.md) — compiling synthesized programs to JavaScript, Python, SQL, and C
- [Server](docs/server.md) — synthesis over HTTP, async jobs, and streaming
- [Roadmap](docs/roadmap.md) — what's shipped and what remains
- [Changelog](CHANGELOG.md)

## lineage

Copper's GPU infrastructure — the native Metal bridge, device bindings, shader dispatch, buffer pool, and profiling harness — is adapted from Smith, a Bun/Metal compute library by the same author (MIT, pinned to commit `d3327014`). Smith is not a runtime dependency; the relevant files are lifted, trimmed to what symbolic computation needs, and credited in their headers. The ILP logic, term representation, packing layer, and ILP-specific shaders are Copper's own. The native layer is built with `bash build.sh` on Apple Silicon — see [docs/gpu.md](docs/gpu.md).

## license

MIT — see [LICENSE](LICENSE).
