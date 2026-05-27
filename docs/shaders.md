# The ILP shaders

Three Metal compute kernels run the inner evaluation loop on the GPU. Each operates on the packed buffers from the packing layer, one thread per unit of work. They live in `native/shaders/` and compile to `copper.metallib` via `build.sh`; the JavaScript wrappers that dispatch them are in `src/engine/ops/`.

## the kernels

**`unify_batch`** — one thread per `(candidate, example)` pair. Each thread reads the candidate's packed term and the example's packed term and performs bounded-depth structural unification, writing a single coverage bit. The unification is iterative, with an explicit stack and per-side variable bindings in thread-local memory — no recursion (Metal's is limited) and no occurs-check (the slot budget already bounds the work, and the precise occurs-checked unification stays on the CPU in `core/unify.js`). This is the first-pass coverage filter.

**`coverage`** — one thread per example, with the candidate fixed. The `unify_batch` kernel specialized to a single candidate, used to compute a full coverage vector once a candidate has passed the filter.

**`constraint_mask`** — one thread per candidate. Each thread compares its candidate's packed region against one forbidden region and writes 1 if they are identical. Because both sides are packed against a shared symbol table, structural equality is integer equality. This is the GPU form of the clause-set membership the constraint learner does for single-clause candidates.

## the reference is the spec

Each kernel has a CPU reference — `unifyPacked` and the `cpu` backend of each op — written in plain JavaScript. The references are the oracle: the kernel must produce exactly the same mask. This split is what lets the algorithms be developed and tested without a GPU. The CPU backend runs in CI on every platform; a Mac-only parity test (`tests/ops-gpu.test.js`) runs the GPU backend on a shared set of inputs and asserts the masks match bit for bit. So "is the kernel correct?" reduces to "does it match a reference that's already proven correct in CI?" — a much smaller question than auditing MSL by eye.

```js
import { unifyBatch } from "copper-ilp/engine"

const mask = await unifyBatch(candidates, examples, layout)            // CPU (default, anywhere)
const mask = await unifyBatch(candidates, examples, layout, { backend: "gpu" }) // Metal (Apple Silicon)
```

## bounds and the escape hatch

The kernels use compile-time array bounds — `COPPER_MAX_VARS` (a clause's variable count) and `COPPER_MAX_STACK` (the unification frontier) — generous for the ILP regime. A problem that exceeds them is the architecture's "recompile the shaders for this bias" case, not a silent failure. Building requires Apple Silicon and the Xcode command line tools: `bash build.sh` compiles the bridge and the shaders into `copper.metallib`.

## what this accelerates, honestly

These kernels accelerate *structural* unification — term-against-term matching with variable binding. They do not run background predicates (arbitrary JavaScript can't move to the GPU), so coverage that depends on background resolution still finishes on the CPU. The GPU's contribution is the embarrassingly parallel structural filter across a wide candidate frontier; the speedup is measured, with honest workload characterization, in #015.
