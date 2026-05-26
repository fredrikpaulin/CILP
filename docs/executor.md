# The executor

The executor runs a restricted logic language: definite Horn clauses, no cuts, no `assert`/`retract`, no meta-programming, bounded recursion depth. This document covers its building blocks as they land. So far: the term language and unification.

## the term language

Everything the executor reasons about is a plain JSON object. Six structures, defined once as JSON Schema (draft 2020-12) in `src/schema.js`:

```
Term     = Variable | Constant | Compound
Variable = { type: "var",      name: string, id?: integer }
Constant = { type: "const",    value: string | number | boolean }
Compound = { type: "compound", functor: string, args: Term[] }
Atom     = { predicate: string, args: Term[] }
Clause   = { head: Atom, body: Atom[] }
Program  = { clauses: Clause[] }
```

A variable carries a symbolic `name` for readability. Its integer `id` is optional in the schema because authored programs use names; the normalization pass adds ids at executor entry. A clause with an empty `body` is a fact.

### validation

`validate(value, kind)` checks a value against one of the named schemas and returns `{ valid, errors }`. `kind` defaults to `"program"`. Convenience predicates wrap it:

```js
import { validate, isTerm, isAtom, isClause, isProgram } from "copper-ilp"

isTerm({ type: "const", value: 42 })            // true
isProgram({ clauses: [/* ... */] })             // true
validate({ type: "var" }, "term").errors        // ["#: missing required \"name\""]
```

The validator is generated from the schemas rather than hand-written, so the schema is the single source of truth. It implements only the JSON Schema keywords these definitions use — it is not a general-purpose validator.

## unification

`unify(a, b, sub?)` is the standard algorithm with occurs-check. A substitution maps variable ids to terms. The function returns a new substitution on success or `null` on failure, and never mutates its input. The substitution is *persistent*: binding path-copies a small radix trie keyed on the variable id, sharing structure with the prior version, so each bind is O(log) rather than the O(n) full copy a plain `Map` would force — a single `unify` over a deep or wide term is no longer O(n²) in its bindings. The interface still mirrors a `Map` (`has`/`get`/`size`), and a plain `Map` is still accepted as a seed (the common empty one), so callers and tests that pass `new Map()` keep working.

```js
import { unify, walk, applySubstitution } from "copper-ilp"

const X = { type: "var", name: "X", id: 0 }
const sub = unify(X, { type: "const", value: "a" })   // Map { 0 => {const a} }
walk(X, sub)                                           // { type: "const", value: "a" }
```

`walk(term, sub)` follows a variable through the substitution chain to whatever it is bound to, returning the term unchanged if it is not a bound variable. `applySubstitution(term, sub)` resolves a term fully, replacing bound variables all the way down — used to materialize a result for output.

Unification expects variables to carry integer ids; the executor operates on normalized terms. The occurs-check refuses bindings that would build an infinite term, so `X = f(X)` fails rather than looping.

## background predicates

Background knowledge is a set of predicates registered by name. A predicate is the boundary between logic and ordinary JavaScript: it may reason over terms or call out to anything — an array, a parser, the network. It comes in two shapes.

```js
import { makeRegistry } from "copper-ilp"

const registry = makeRegistry({
  // a test: return true (holds), false (fails), or a substitution Map (holds with bindings)
  positive: (args, sub) => {
    const a = applySubstitution(args[0], sub)
    return a.type === "const" && a.value > 0
  },
  // non-deterministic: a generator yielding a substitution per solution
  *parent(args, sub) {
    for (const [p, c] of PARENTS) {
      let s = unify(args[0], { type: "const", value: p }, sub)
      if (s === null) continue
      s = unify(args[1], { type: "const", value: c }, s)
      if (s !== null) yield s
    }
  }
})
```

A plain function returning `true` succeeds with no new bindings; returning a substitution `Map` succeeds with those bindings; returning a falsy value fails. A generator yields one substitution per solution. `args` are the goal's argument terms as written — the predicate walks or applies the substitution itself. A predicate name is either background or program-defined, never both.

`loadBackground(path)` loads a module that exports `{ predicates: {...} }` and returns a registry. Relative paths resolve against the working directory.

## resolution

`interpret(program, registry, query, options?)` runs a query atom against a program, dispatching background predicates to the registry. It is a generator yielding one substitution per solution, lazily — backtracking is implicit in generator resumption.

```js
import { interpret, walk } from "copper-ilp"

for (const sub of interpret(program, registry, query, { maxDepth: 3 })) {
  // each `sub` is a solution; walk a query variable to read its binding
}
```

This is copper-core's reference interpreter (Appendix A §A.4): the meaning of a JSON program is whatever it yields, and lowerings must agree with it.

`maxDepth` — the bias's `max_recursion_depth` — caps how many times a single predicate may be *simultaneously active* along a derivation path. Each goal tracks, per predicate, the number of active program-clause expansions among its ancestors; a goal whose predicate already has `maxDepth` activations above it is not expanded. This bounds genuine recursion: a predicate may nest at most `maxDepth` deep, which keeps resolution total (each predicate appears boundedly often on a path, and there are finitely many). A long *non-recursive* conjunction of program goals is not cut, because sibling goals don't inherit each other's depth — only nested re-entry of the same predicate counts. Background-predicate calls don't expand clauses and don't count. On each clause use, the clause's variables are renamed to fresh ids ("standardizing apart") so recursive and repeated uses never clash with the query's variables or with each other.

## normalization

Authored programs use symbolic variable names; the interpreter works with integer ids. `normalize(node)` bridges the two — it assigns ids and returns `{ value, names }`, where `value` is the node with ids and `names` maps ids back to symbolic names. `denormalize(node)` strips the ids, restoring authored form.

```js
import { normalize, denormalize } from "copper-ilp"

const { value, names } = normalize(clause) // value has ids; names: Map { 0 => "X", ... }
denormalize(value)                          // back to name-only form
```

Variables are scoped per clause: the same name in two clauses is two different variables, so each clause is normalized independently with ids assigned in first-appearance order from 0. Names are preserved throughout, so the round-trip is exact. For a Program, `names` is an array of maps, one per clause.

## evaluating coverage

`coverage(program, registry, { positives, negatives }, options?)` is the executor's evaluation harness: it normalizes the program, runs each example through the interpreter, and reports which examples the program entails.

```js
import { coverage } from "copper-ilp"

const result = coverage(winRule, registry, {
  positives: [/* example atoms the program should entail */],
  negatives: [/* example atoms it should not */]
})
// result.correct === true when every positive is covered and no negative is
```

`covers(program, registry, example, options?)` is the single-example primitive — true if the program entails the example. `coverage` answers the yes/no question the search loop needs on its hot path, where a proof would be wasted work.

## verification and proof traces

`verify(program, registry, { positives, negatives }, options?)` is `coverage` with evidence. It reports the same per-example coverage and the same `correct` flag, but each example also carries a proof: the ground atoms that witnessed it.

```js
import { verify } from "copper-ilp"

const result = verify(grandparent, registry, {
  positives: [{ predicate: "grandparent", args: [{type:"const",value:"tom"}, {type:"const",value:"ann"}] }],
  negatives: [/* ... */]
})
// result.positives[0] === { example, covered: true, proof: [ ...ground atoms... ] }
// result.negatives[0] === { example, covered: false, proof: null }
```

A proof is the flat list of ground atoms that fired along the first successful derivation — clause-head expansions and the background facts that discharged each body goal, fully grounded by the final substitution. For `grandparent(tom, ann)` derived from `grandparent(X,Z) :- parent(X,Y), parent(Y,Z)`, the proof carries the head `grandparent(tom, ann)` and the two witnessing facts `parent(tom, bob)` and `parent(bob, ann)`. It is evidence, not assertion: re-running each background atom against the registry reproduces it. An example that does not hold has `covered: false` and `proof: null` — there is no derivation to record.

`firstProof(program, registry, goal, options?)` is the underlying primitive: the first derivation of a single goal as a proof trace, or `{ covered: false, trace: null }`. Like `interpret`, it expects a normalized program (variables carry ids); `verify` normalizes for you.

Two honest limits. First, verification re-executes the program on the examples — its cost is proportional to the example count and the proof size, not the search space. It does not re-run search. Second, it certifies coverage on the *given* examples, which is not the same as generalization to unseen inputs. "Verified" here means "covers these examples and excludes these counter-examples," not "trustworthy on inputs you haven't shown it."

## the JSON-IR invariant

The JSON program is the source of truth. `synthesize` always returns it in the `program` field — when a solution is found, `program` is that program; when the search ends without an acceptable one but a best candidate was seen, `program` is the best; when nothing was enumerated, `program` is `null`. It is never silently absent, whatever else the call produces.

This matters because the interpreter (`interpret`, §resolution) is the *reference semantics*. The meaning of a program is whatever it yields, and verification is defined against it. A future lowering — JSON compiled to JavaScript, or to a packed GPU representation — is correct exactly when it agrees with the interpreter on every example. A disagreement is a lowering bug, not a synthesis bug, and the JSON program is what you check the lowering against.
