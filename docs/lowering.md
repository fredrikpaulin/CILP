# Lowering

The JSON program is the source of truth, but an agent often wants ordinary source code it can run without shipping an interpreter. A lowering is a pure function from a JSON program to target-language source:

```
lower(program, harness, options?) => { source, metadata }
```

The first target is JavaScript. The interpreter (`interpret`) is the reference semantics: lowered code must produce the same solutions on the same inputs, and a discrepancy is a lowering bug, not a synthesis bug. That equivalence — not plausible-looking output — is the definition of a correct lowering.

```js
import { lower } from "copper-ilp/core"

const { source, metadata } = lower(program, manifest, { target: "javascript", modes: { grandparent: ["in", "out"] } })
```

`lower` dispatches on `options.target` (default `"javascript"`); `lowerJavaScript` is the JS pass directly.

## modes do the work

Lowering needs a mode for every argument of every predicate the program calls: `in` (bound when the call is made) or `out` (produced by the call). Body-predicate modes come from the harness manifest; the target predicate's modes come from the bias, which the caller passes in `options.modes` (a `{ predicate: ["in"|"out", …] }` map merged over the manifest).

Modes turn a logic clause into native control flow. Each head predicate lowers to a **generator** whose parameters are the head's `in` arguments and which yields the head's `out` arguments — one yield per solution. A body goal `parent(X, Y)` with modes `[in, out]` becomes a loop that binds `Y` from `parent`'s solutions given `X`. A deterministic primitive is a loop that runs at most once; a non-deterministic one (like `member`) is a loop that runs per solution. The substitution-threading and clause-selection the interpreter does at runtime are compiled away — what remains at the primitive boundary is a direct call into the implementation.

```js
// grandparent(X, Z) :- parent(X, Y), parent(Y, Z).   modes [in, out]
export function* lowered_grandparent(_in0) {
  {
    const v_X = _in0
    for (const _s0 of _solve("parent", [v_X, { type: "var", name: "Y", id: 1 }])) {
      const v_Y = applySubstitution({ type: "var", name: "Y", id: 1 }, _s0)
      for (const _s1 of _solve("parent", [v_Y, { type: "var", name: "Z", id: 2 }])) {
        const v_Z = applySubstitution({ type: "var", name: "Z", id: 2 }, _s1)
        yield [v_Z]
      }
    }
  }
}
```

The generated module imports `makeRegistry`/`applySubstitution` from `copper-ilp/core` and the primitives from the target implementation (the same per-target file the harness registry loads, e.g. `./javascript.js`). A recursive body goal — a call to one of the program's own head predicates — becomes a recursive generator call.

## the feasibility report

Not every program lowers. `metadata` carries a feasibility report:

- `feasibility: "ok"` — lowered cleanly, `caveats: []`.
- `feasibility: "caveats"` — lowered, but `caveats` lists concerns. Recursion is the current one: it lowers to native recursive generators with no depth bound, so it relies on the data being well-founded (the interpreter's `maxDepth` guard has no equivalent in the lowered code).
- `feasibility: "infeasible"` — `source` is `null` and `reason` says why. A program is infeasible when a predicate has no mode declaration, when it is ill-moded (a goal reads a variable no earlier goal has bound), or when it uses the parts of the language this lowering doesn't cover yet — compound or non-variable arguments.

`metadata` also lists `imports` (the module specifiers the source pulls in) and `entrypoints` (the exported generator names).

## honest scope

This is target-unaware lowering: synthesize first, lower after, report feasibility. Target-biased synthesis — steering the search toward programs that lower cleanly to a chosen target — is a later feature (#032).

The JS lowering is faithful but thin. It compiles away the clause machinery (head unification, standardize-apart, clause selection) into native control flow, but a primitive call still goes through the relational implementation rather than a mode-specialized function, because that's the implementation contract the harness defines. A deeper lowering that calls primitives in fully mode-directed form is future work. What's pinned now is the contract — `lower(program, harness) => { source, metadata }`, checked against the interpreter — and one target that satisfies it.
