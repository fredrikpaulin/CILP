# The synthesis server

Synthesis runs in the engine, which needs Bun and (for the GPU path) Apple Silicon. A field agent on smaller hardware can't run it — so the engine ships an HTTP server that exposes synthesis as a service. The agent sends a problem and gets back the JSON program, a proof, any requested lowerings, and a harness summary: enough to use and to trust the result without re-running the search.

Synthesis takes seconds to minutes, so the default is asynchronous: a request starts a job and returns its id, and the agent polls or subscribes for the result. A client that expects a fast answer can ask for it inline with `Prefer: respond-sync`. Authentication, rate limiting, and quotas are deployment configuration, not engine code, and are out of scope.

## running it

```js
import { serve, makeHandler } from "copper-ilp/engine"

serve({ port: 8787, registryRoot: "libraries" }) // binds Bun.serve
```

`makeHandler(options)` returns a plain `(Request) => Promise<Response>` — the whole server is just that function, so it can be tested without binding a port. `serve` wraps it in `Bun.serve`. `registryRoot` points at the curated [library registry](harness.md#the-library-registry).

## endpoints

```
POST /v1/synthesize                  submit a problem, start a job (or answer inline)
GET  /v1/jobs/{id}                    poll a job's status and result
GET  /v1/jobs/{id}/stream            stream best-so-far results over SSE
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

By default the response is a job handle: `202 Accepted` with `{ "status": "pending", "job_id": "…", "status_url": "/v1/jobs/…" }`. The search runs in the background; the agent polls the status URL or subscribes to the stream.

With a `Prefer: respond-sync` header the server waits up to a short window (5 s by default) for the search to finish. If it completes, the solution comes back inline with `200`; if not, the server falls back to the job handle and the search keeps running. Either way the solution shape is the same:

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

### GET /v1/jobs/{id}

Polls a job. While the search runs it returns `{ "status": "pending", "job_id", "status_url" }`; when it finishes, the same `{ "status": "complete", "solution": { … } }` shape as the inline response. An unknown id is a 404.

### GET /v1/jobs/{id}/stream

A Server-Sent Events stream of the search's progress. It emits a `partial` event each time the best-so-far program improves — `{ program, stats }` — and a final `complete` event carrying the full solution, then closes. Partials already recorded when the stream opens are replayed, so a late subscriber still sees the progression. The agent can hang up early to accept the last partial it saw; the server drops the subscriber and the job keeps running (still pollable). This is what makes a long search usable: the agent watches coverage climb and stops when it's good enough.

### GET /v1/capabilities

Reports `engine_version`, `supported_targets`, `available_libraries` (name and versions), a `typical_latency_ms` profile (unmeasured in the MVP, so `null`), and `features`. `streaming` is now `true`; `clarification` and `target_biased_synthesis` remain `false` until those tickets land.

### GET /v1/libraries and /v1/libraries/{lib}/{version}

The first lists curated libraries and their versions. The second returns a `{ manifest, implementations }` pair — the manifest plus the source text of each available per-target implementation — which is what an agent fetches, verifies against the manifest hash, and runs locally. A bare `/v1/libraries/{lib}` resolves to the latest version.

## lowering cache

Lowered source is a pure function of the program, the lowering options, the harness's semantics, and the lowering code, so the server caches it: a program it has already lowered to a target comes back from the cache instead of being recomputed. The cache key includes a canonical form of the program and options, the harness's `semantic_hash`, and a `LOWERING_VERSION` stamp — so a changed lowering never serves stale source. `makeHandler` creates one cache per server instance; pass `options.loweringCache` to inject your own (`makeLoweringCache(lowerFn)` from `copper-ilp/engine`, with `stats` and `size`). The store is unbounded for now — eviction is a later concern, like durable job storage.

## scope

The server is unauthenticated and single-process. It is the surface the harness, lowering, and verification work were building toward — remote synthesis that returns a program you can run and a proof you can check, async by default with sync and streaming on top. The job store is in memory, so jobs do not survive a restart, and the background search currently runs in bursts between best-so-far updates rather than fully chunked — fine for the curated workloads, a known limit for pathological ones. Authentication, rate limiting, quotas, and durable job storage are deployment and operations concerns, named and deferred, not hidden.
