# API reference

The agent-facing surface is one function. Everything else is the shape of its input and output.

> This reference describes the intended API. The system is under construction; not every field is wired up yet. Where behavior is still being settled, the roadmap says so.

## `synthesize(problem)`

```
synthesize(problem: Problem): Promise<Solution>
```

Searches for a program that entails every positive example, no negative example, and stays within the bias. Resolves to the best solution found within the search budget.

### Problem

```
Problem = {
  bias: Bias,
  background: string,          // module path; the module exports { predicates: {...} }
  positives: Example[],
  negatives: Example[],

  // optional search budget
  max_candidates?: number,
  max_time_ms?: number,
  target_coverage?: number,
  noise_tolerance?: number     // allow up to k misclassifications
}

Bias = {
  head_predicates: PredicateDecl[],
  body_predicates: PredicateDecl[],
  max_clauses: number,
  max_body_length: number,
  max_variables: number,
  max_recursion_depth: number,
  allow_recursion: boolean
}

PredicateDecl = {
  name: string,
  arity: number,
  arg_types: TypeRef[],
  mode: ("in" | "out")[]       // argument direction
}
```

The `background` module exports a `predicates` object mapping predicate names to JavaScript functions or generators. See [background predicates](#background-predicates). For in-process use, `background` may instead be a registry (from `makeRegistry`) or a plain predicates object, rather than a path.

### Solution

```
Solution = {
  program: Program | null,     // the program found, or null if none within budget
  coverage: Coverage,          // per-example coverage of the returned program
  stats: {
    candidates_tested: number,
    time_ms: number,
    search_exhausted: boolean, // true if the enumerator ran out before the budget
    found: boolean             // true if an acceptable program was returned
  }
}
```

A program is *acceptable* when it covers at least `target_coverage` of the positives (default 1.0) and at most `noise_tolerance` negatives (default 0) — the classic "all positives, no negatives" by default. `synthesize` returns the first acceptable program in the enumerator's order, or the best-scoring one seen if the budget runs out first.

The `program` field is always present: the found program, the best candidate seen, or `null` when nothing was enumerated. It is the JSON-IR invariant — the synthesized JSON program is the source of truth, and any lowering of it is checked against the interpreter, never the other way around.

## verification

```
verify(program, registry, { positives, negatives }, options?): Result
firstProof(program, registry, goal, options?): { covered, trace }
```

`verify` runs a program against examples and returns per-example coverage with a proof for each: `{ example, covered, proof }`, where `proof` is the list of ground atoms that witnessed a positive (clause heads and the background facts that discharged each goal) or `null` for anything that does not hold. `correct` is true when every positive holds and no negative does. `firstProof` is the single-goal primitive. Both live in `copper-ilp/core`; see [the executor](executor.md#verification-and-proof-traces) for the proof format and the honest limits — verification re-executes on the examples (it does not re-run search) and certifies coverage on the given examples, not generalization.

## the term language

Six structures, all JSON, all schema-validated.

```
Term     = Variable | Constant | Compound
Variable = { type: "var",      name: string, id: number }
Constant = { type: "const",    value: string | number | boolean }
Compound = { type: "compound", functor: string, args: Term[] }
Atom     = { predicate: string, args: Term[] }
Clause   = { head: Atom, body: Atom[] }
Program  = { clauses: Clause[] }
```

Variables carry symbolic `name`s for readability; the executor maps them to integer `id`s internally and restores the names on output.

## background predicates

A background module exports predicates by name:

```js
export const predicates = {
  // deterministic: return true/false, or bind output args
  succ(a, b) { /* ... */ },

  // non-deterministic: a generator yielding each solution
  *member(x, list) { /* yield ... */ }
}
```

A predicate may be pure logic over the term language or may call arbitrary JavaScript — an AST library, a database, the network. Bounded depth and arity are enforced by the executor and declared in the bias.

## harness manifests

A harness manifest is the language-agnostic declaration of the primitives a program may call — name, arity, arg types, modes, determinism, a description, and canonical example calls. A `semantic_hash` over the declarations lets an implementation detect it was built against a different version of the manifest.

```
validateManifest(manifest): { valid, errors }      // schema + structural checks
loadManifest(objectOrJson): HarnessManifest         // parse + validate, throws on invalid
semanticHash(manifest): Promise<string>             // deterministic "sha256:…"
withHash(manifest): Promise<HarnessManifest>         // copy with semantic_hash filled in
verifyManifest(manifest): Promise<{ valid, errors }> // validate + check stored hash
checkImplementation(impl, manifest): Promise<true>   // throws on hash mismatch
loadHarness(manifest, impl): Promise<Registry>       // verify hash, then build a registry
conform(manifest, impl): { conforms, results, untested } // run the declared example calls
```

All live in `copper-ilp/core`. The hash is order-independent over primitives and keys and excludes `library`/`version`, so identical primitives hash alike across version labels. `conform` checks behaviour rather than identity: it runs each declared example call and compares solutions to the declared `result` (`true`/`false`, or `{ solutions }`). See [harness manifests](harness.md) for the format, the hash semantics, conformance, and what's deferred to cross-target conformance (#029).

## the library registry

Curated libraries are distributed as files under `<root>/<library>/<version>/` — a `manifest.json` and per-target implementations. `libraryRegistry(root)` (from `copper-ilp/engine`) resolves them:

```
libraryRegistry(root): {
  list(): Promise<{ library, version }[]>            // local only
  versions(library): Promise<string[]>
  resolveVersion(library, version): Promise<string>  // "latest" → highest
  manifest(library, version): Promise<HarnessManifest>
  implementationSource(library, version, target?): Promise<string>
  load(library, version, target?): Promise<{ manifest, registry, … }>  // verify hash, build registry
}
```

`root` is a local directory or an HTTP base URL. Reading (manifest, source) works over either; `load` runs the implementation and is local-only. The HTTP surface over this registry is the server's `/v1/libraries` endpoints (#027). User-uploaded libraries are not supported in v1.

## lowering

A lowering compiles a JSON program to target-language source. The JSON interpreter is the reference semantics; lowered code must match it.

```
lower(program, harness, options?): { source, metadata }
lowerJavaScript(program, harness, options?): { source, metadata }

metadata = {
  target: string,
  feasibility: "ok" | "caveats" | "infeasible",
  caveats: string[],
  reason: string | null,        // set when infeasible; source is null
  imports: string[],
  entrypoints: string[]
}
```

`lower` dispatches on `options.target` (default `"javascript"`). Both live in `copper-ilp/core`. Modes are mandatory: body-predicate modes come from the harness manifest, and the target predicate's modes are passed in `options.modes` (a `{ predicate: ["in"|"out", …] }` map). `options.implementation` and `options.core` set the module specifiers the generated source imports. A program that is unmoded, ill-moded, or uses compound/non-variable arguments is reported `infeasible`; recursion lowers with a `caveats` report. See [lowering](lowering.md).

## stability

The package is pre-1.0. The problem and solution schemas are the contract; treat anything not listed here as internal.
