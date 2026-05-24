# The synthesis server

Synthesis runs in the engine, which needs Bun and (for the GPU path) Apple Silicon. A field agent on smaller hardware can't run it — so the engine ships an HTTP server that exposes synthesis as a service. The agent sends a problem and gets back the JSON program, a proof, any requested lowerings, and a harness summary: enough to use and to trust the result without re-running the search.

The MVP is synchronous. A request runs the search to completion within its budget and returns the result. Asynchronous jobs and streaming are a later addition (#028). Authentication, rate limiting, and quotas are deployment configuration, not engine code, and are out of scope.

## running it

```js
import { serve, makeHandler } from "copper-ilp/engine"

serve({ port: 8787, registryRoot: "libraries" }) // binds Bun.serve
```

`makeHandler(options)` returns a plain `(Request) => Promise<Response>` — the whole server is just that function, so it can be tested without binding a port. `serve` wraps it in `Bun.serve`. `registryRoot` points at the curated [library registry](harness.md#the-library-registry).

## endpoints

```
POST /v1/synthesize                  submit a problem, get a solution
GET  /v1/capabilities                what this engine instance can do
GET  /v1/libraries                   list curated libraries
GET  /v1/libraries/{lib}/{version}   fetch a manifest and its implementations
```

### POST /v1/synthesize

```json
{
  "problem": { "bias": { ... }, "positives": [ ... ], "negatives": [ ... ] },
  "library": "lists@1.0.0",
  "budget": { "max_time_ms": 5000, "max_candidates": 2000, "target_coverage": 1.0 },
  "targets": ["javascript"],
  "options": { "noise_tolerance": 0 }
}
```

The agent supplies the bias and examples; the named `library` supplies the background, resolved and hash-verified from the registry (the agent never ships executable code to the server). Every request must carry a `budget` — synthesis without a bound is not offered. `targets` is optional and defaults to none.

```json
{
  "status": "complete",
  "solution": {
    "program": { "clauses": [ ... ] },
    "lowerings": { "javascript": { "source": "...", "feasibility": "ok", "caveats": [], "reason": null } },
    "proof": [ { "example": ..., "covers": true, "trace": [ ... ] }, ... ],
    "harness_manifest": { "library": "lists", "version": "1.0.0", "primitives_used": ["head"], "semantic_hash": "sha256:..." },
    "stats": { "candidates_tested": ..., "time_ms": ..., "search_exhausted": false, "found": true }
  }
}
```

`program` is always present (it may be `null` if nothing was found within budget — `stats.found` says which). `lowerings` carries an entry only for each requested target, each with its source and [feasibility report](lowering.md#the-feasibility-report). `proof` is one entry per example — the witnessing bindings that made each positive match and the confirmation that each negative did not — which is what makes the result evidence rather than just an answer. `harness_manifest` names only the primitives the program actually calls.

### GET /v1/capabilities

Reports `engine_version`, `supported_targets`, `available_libraries` (name and versions), a `typical_latency_ms` profile (unmeasured in the MVP, so `null`), and `features`. At v1.0 every feature flag — `streaming`, `clarification`, `target_biased_synthesis` — is `false`; they turn on as those tickets land.

### GET /v1/libraries and /v1/libraries/{lib}/{version}

The first lists curated libraries and their versions. The second returns a `{ manifest, implementations }` pair — the manifest plus the source text of each available per-target implementation — which is what an agent fetches, verifies against the manifest hash, and runs locally. A bare `/v1/libraries/{lib}` resolves to the latest version.

## scope

This is the v1.0 server: synchronous, unauthenticated, single-process. It is the surface the harness, lowering, and verification work were building toward — remote synthesis that returns a program you can run and a proof you can check. What it deliberately leaves out — async jobs, streaming partial results, and all of production operations — is named and deferred, not hidden.
