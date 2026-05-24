# Harness manifests

Background knowledge used to be "JS functions registered by name." That's fine until a second implementation exists — a Python port, an optimized rewrite, a bug-fixed copy — and nothing pins what those implementations are supposed to *mean*. A harness manifest is that pin: a JSON document declaring the primitives a program may call, language-agnostic, with a hash that catches a stale implementation before it miscompiles.

## the manifest

```
HarnessManifest = {
  library: string,            // e.g. "kinship"
  version: string,            // semver, e.g. "1.0.0"
  primitives: PrimitiveDecl[],
  semantic_hash?: string      // "sha256:…", stamped by withHash
}

PrimitiveDecl = {
  name: string,
  arity: number,
  arg_types?: string[],       // one per argument
  modes?: ("in" | "out")[],   // one per argument
  description: string,        // natural-language semantics
  determinism: "det" | "nondet",
  examples?: { call: Atom, result?: ... }[]   // canonical calls
}
```

A manifest describes *what* primitives exist and what they mean, not *how* they are implemented. The same manifest is consumed by the interpreter and, later, by every lowering — JSON to JavaScript, Python, and so on. That separation is the point: semantics change rarely, implementations get refactored and optimized constantly, and the manifest is the stable contract between them.

The `modes` field is one direction per argument (`parent(P, C)` queried as `["in","out"]`), distinct from the bias's `predicateDecl`, which uses `mode` and carries no description, determinism, or examples. They are different declarations for different jobs — a bias scopes a search, a manifest defines a primitive — so they are separate schemas.

The example `call`s double as a conformance suite: every implementation of a manifest must agree on them. Executing and comparing those results is the conformance check (#024); the manifest just declares them.

## validating

`validateManifest(manifest)` returns `{ valid, errors }`. It runs the JSON Schema check and then the cross-checks the schema can't express: arity must match `arg_types` and `modes` lengths, every example `call` must name its primitive and match its arity, and primitive names must be unique.

```js
import { validateManifest, loadManifest } from "copper-ilp/core"

validateManifest(manifest).valid          // true
loadManifest(jsonText)                     // parses + validates, throws on invalid
```

`loadManifest` accepts a manifest object or its JSON text, validates, and returns it — or throws with the collected errors.

## the semantic hash

`semanticHash(manifest)` derives a `sha256:…` string from the canonical primitive declarations. It is **deterministic and order-independent**: the same primitives in a different array order, or the same fields written in a different key order, produce the same hash. It deliberately excludes `library` and `version` — those are identity labels, not semantics — and the stored hash itself.

```js
import { semanticHash, withHash, verifyManifest } from "copper-ilp/core"

await semanticHash(manifest)               // "sha256:e31dad8f…"
const stamped = await withHash(manifest)   // manifest with semantic_hash filled in
await verifyManifest(stamped)              // { valid: true, errors: [] }
```

Because the hash ignores version labels, two manifests with identical primitives hash alike whatever they're versioned as. That is what makes an implementation safe to reuse across a no-op version bump — and what makes a real change (an arity, a mode, a determinism flip, an example) move the hash even if the version didn't.

`verifyManifest` is `validateManifest` plus a check that any recorded `semantic_hash` matches the computed one — it catches a manifest edited without re-stamping its hash.

## loading an implementation

An implementation records the manifest hash it was built against. `loadHarness` verifies that hash before handing back a registry the interpreter can use:

```js
import { loadHarness } from "copper-ilp/core"

// implementation: { semantic_hash: "sha256:…", predicates: { parent, eq } }
const registry = await loadHarness(manifest, implementation)
// throws if implementation.semantic_hash !== semanticHash(manifest)
```

A mismatch — the common failure where an agent holds a stale implementation against an evolved manifest — is rejected at load, before a single goal resolves. `checkImplementation(implementation, manifest)` is the bare check if you want it without building the registry.

This is the seam where a manifest reaches the interpreter: a registry is no longer a bare bag of functions, but a manifest paired with a hash-checked implementation.

## conformance

The hash checks *identity* — that an implementation targets the manifest you mean. It says nothing about whether the implementation actually behaves the way the manifest declares. That's conformance, and the manifest's example calls are the test suite for it.

`conform(manifest, implementation)` runs every declared example call against the implementation and checks the solutions match the declared result:

```js
import { conform } from "copper-ilp/core"

const { conforms, results, untested } = conform(manifest, implementation)
// conforms: true when every example agreed
// results:  [{ primitive, call, conforms, error? }, ...]
// untested: primitives that declare no examples — not failures, just not exercised
```

A declared example's `result` says what the call should produce:

- `true` (or omitted) — the call must hold: at least one solution.
- `false` — the call must not hold: zero solutions.
- `{ solutions: [ { varName: Term }, … ] }` — the exact set of variable bindings, compared order-independently. This is how an output predicate pins its answer: `head(cons(1, …), H)` declares `{ solutions: [{ H: 1 }] }`, and a nondet predicate declares one entry per solution.

`conform` is hash-agnostic — it reads only the implementation's predicates, so you can run it while authoring, before the hash is stamped. The hash and conformance are complementary: `loadHarness` checks the hash (a stale build), `conform` checks behaviour (a buggy predicate). A full trust check is both. A primitive that declares no examples is reported in `untested` rather than silently counted as passing — a thin manifest shouldn't masquerade as a tested one.

### the curated `lists` library

`libraries/lists/1.0.0/` is the first curated library and a worked example of the whole contract: a `manifest.json` declaring `cons`, `head`, `tail`, `empty`, and `member` — deterministic output bindings, a det test with both a true and a false example, and a non-deterministic enumeration — and a `javascript.js` implementation that records the manifest hash and passes every declared example. It is the conformance target the tests run against.

## the library registry

Curated libraries are distributed as files, laid out by name and version:

```
<root>/<library>/<version>/manifest.json
<root>/<library>/<version>/<target>.js     # e.g. javascript.js
```

`libraryRegistry(root)` (from `copper-ilp/engine`) resolves that layout. The `root` is a local directory or an HTTP base URL — distribution is git or HTTP fetch from the repository, with no publishing API and no versioning service.

```js
import { libraryRegistry } from "copper-ilp/engine"

const reg = libraryRegistry("libraries")
await reg.list()                          // [{ library: "lists", version: "1.0.0" }, …]
await reg.versions("lists")               // ["1.0.0"]
await reg.manifest("lists", "latest")     // load + validate; "latest" → highest version
await reg.implementationSource("lists", "1.0.0")   // the target's source text
const { manifest, registry } = await reg.load("lists", "latest")  // verified, ready to run
```

`load` is the fetch-and-verify loop end to end: it reads the manifest, imports the implementation, checks the implementation's recorded hash against the manifest (`loadHarness`), and hands back a background registry the interpreter can use. A stale implementation is rejected before any goal resolves.

Reading is safe over either transport; *loading* runs the implementation's code, so `load` is local-only. Over HTTP you fetch the manifest and source first (`manifest`, `implementationSource`), write them locally, then `load`. The server endpoints `/v1/libraries` and `/v1/libraries/{lib}/{version}` (#027) are this registry behind HTTP.

**User-uploaded libraries are not supported in v1.** Running arbitrary fetched code in a synthesis service is a sandboxing problem with its own design pass; the registry serves only project-curated libraries. An agent that wants custom predicates self-hosts the engine and loads its own libraries directly.

## honest scope

The manifest pins semantics, the hash catches stale implementations, conformance checks one implementation against the declared examples, and the registry distributes and verifies them. What's deferred: *cross-target* conformance — running the same program through each lowering against the same examples and confirming they agree — has no meaning until a second target exists (Python, #029), at which point it belongs in CI. The HTTP surface over the registry is #027.
