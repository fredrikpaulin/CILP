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

## honest scope

The manifest pins semantics and catches stale implementations; it does not *prove* an implementation is correct. That proof is the conformance suite — running the declared example calls against the implementation and checking they agree — which is #024. And the file-based library registry that distributes manifests and implementations (`libraries/<name>/<version>/`) is #025. This document is the format and the hash; those two build on it.
