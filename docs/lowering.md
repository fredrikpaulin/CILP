# Lowering

The JSON program is the source of truth, but an agent often wants ordinary source code it can run without shipping an interpreter. A lowering is a pure function from a JSON program to target-language source:

```
lower(program, harness, options?) => { source, metadata }
```

The targets today are JavaScript, Python, and SQL. The interpreter (`interpret`) is the reference semantics: lowered code must produce the same solutions on the same inputs, and a discrepancy is a lowering bug, not a synthesis bug. That equivalence — not plausible-looking output — is the definition of a correct lowering.

```js
import { lower } from "copper-ilp/core"

const { source, metadata } = lower(program, manifest, { target: "javascript", modes: { grandparent: ["in", "out"] } })
```

`lower` dispatches on `options.target` (default `"javascript"`); `lowerJavaScript`, `lowerPython`, and `lowerSql` are the per-target passes directly. The mode-checking, feasibility, and clause-grouping analysis is shared across the mode-directed targets (`analyze.js`); SQL has its own relational feasibility analysis. Only the rendering into source differs.

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

## targets

Three targets ship today. The host-language pair render the same mode-directed plan in their own syntax; SQL is relational and takes a different shape.

- **JavaScript** (`target: "javascript"`) — generators yielding out-arg arrays; imports `makeRegistry`/`applySubstitution` from `copper-ilp/core` and `predicates` from the per-target implementation.
- **Python** (`target: "python"`) — the same structure as indentation-scoped generators (`def lowered_…`, nested `for` loops, `yield [..]`); imports `make_registry`/`apply_substitution` from a small `copper_runtime` module and `predicates` from the per-target implementation. Terms are plain dicts of the same JSON shape.

The JavaScript and Python targets share their mode-directed plan and a per-target implementation file beside the manifest in the registry — `javascript.js`, `python.py` — that the lowered code calls into. `options.implementation` and (for JS) `options.core` / (for Python) `options.runtime` set the module specifiers the generated source imports.

### SQL

**SQL** (`target: "sql"`) compiles a program to relational queries rather than control flow. Each head predicate becomes a `CREATE VIEW`; a clause becomes a `SELECT` over its body relations, where a shared variable is a join equality, a constant is a `WHERE` filter, and the head arguments are the projected columns `c0, c1, …`. Multiple clauses for a predicate `UNION`; linear self-recursion becomes a `WITH RECURSIVE` CTE.

```
-- grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
CREATE VIEW grandparent AS
  SELECT t0.c0 AS c0, t1.c1 AS c1 FROM parent AS t0, parent AS t1 WHERE t0.c1 = t1.c0;
```

SQL derives its data flow from joins, so it does **not** require mode declarations — the mode-directed feasibility of the host-language targets doesn't apply. Instead it has its own, narrower envelope, and the feasibility report names what falls outside rather than emitting wrong SQL:

- no compound terms (SQL is flat) and only variable head arguments;
- *range-restricted* rules only — every head variable must be bound by some body goal (an unsafe rule like `q(X, Y) :- parent(X, Z)` can't produce `Y`);
- single-predicate **linear** recursion only — a clause with two recursive calls, or mutual recursion between predicates, has no plain recursive-CTE form and is reported infeasible.

SQL recursion has no depth caveat: a recursive CTE computes the full fixpoint, which matches the interpreter once its `maxDepth` is high enough to reach the same closure. A lowered program expects each primitive relation to exist as a table with columns `c0…c{arity-1}`. The narrowness of this envelope is what motivates target-biased synthesis (#032) — steering the search toward shapes that lower cleanly to SQL.

## cross-target conformance

Because every target is checked against the same interpreter, two targets that each match the interpreter must match each other. That's the cross-target conformance check the harness work was building toward (it had no meaning with one target): lower the same program to JavaScript and to Python, run both over the same examples, and confirm they produce the same solutions. Copper's tests do exactly this for a `lists` program — JS and Python lowerings agree solution-for-solution — which is a strong correctness signal, because an agreement across two independent code generators and two independent primitive implementations is hard to fake.

## target-biased synthesis

Lowering is target-*unaware* by default: synthesize first, lower after, report feasibility. But an agent can declare a target up front and have the search bias toward programs that lower cleanly to it — `synthesize(problem, { target: "sql" })`. A covering candidate is then accepted only if it also lowers feasibly to the declared target; a covering-but-infeasible candidate is skipped (counted in `stats.candidates_target_skipped`) and the search continues. The gate reuses the lowering's own feasibility report, so the bias and the lowering can never disagree.

The effect is measurable: given the unsafe rule `gp(X, Z) :- parent(X, Y)` (which covers the examples but lowers to neither SQL nor JavaScript, since `Z` is never produced) ahead of the real `gp(X, Z) :- parent(X, Y), parent(Y, Z)`, target-unaware synthesis returns the first — and it won't lower — while `target: "sql"` skips it and returns the one that does. The cost is generality: if every covering program is target-infeasible, biased synthesis reports `found: false` rather than hand back something unusable. JavaScript and Python targets need the bias to declare modes (the gate calls the mode-directed lowering); SQL needs none.

The host-language lowerings (JavaScript, Python) are faithful but thin. They compile away the clause machinery (head unification, standardize-apart, clause selection) into native control flow, but a primitive call still goes through the relational implementation rather than a mode-specialized function, because that's the implementation contract the harness defines. A deeper lowering that calls primitives in fully mode-directed form is future work. SQL is a different kind of target — a genuine relational compilation, not a thin layer over a runtime — but it pays for that with a narrower envelope (flat, range-restricted, linearly recursive). What's pinned now is the contract — `lower(program, harness) => { source, metadata }`, checked against the interpreter — and three targets that satisfy it: two that agree with each other, and one that matches the interpreter's fixpoint on the relational subset.
