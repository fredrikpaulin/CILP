// The synthesis server. It exposes synthesis as an HTTP service so a field agent on
// hardware that can't run the engine can synthesize remotely, get back a program it can
// run and a proof it can check.
//
// Synthesis takes seconds to minutes, so the default is asynchronous: POST /v1/synthesize
// starts a job and returns its id; GET /v1/jobs/{id} polls. A client that wants a fast
// answer sends `Prefer: respond-sync`, and the server waits up to a short timeout before
// falling back to a job id. GET /v1/jobs/{id}/stream emits Server-Sent Events carrying the
// best-so-far program as the search improves, and survives the client hanging up early.
//
// Authentication, rate limiting, and quotas are deployment configuration, not engine code,
// and are out of scope. `makeHandler` returns a plain (Request) => Promise<Response> so the
// whole server — jobs and streams included — is testable without binding a port.

import { verify } from "../core/index.js"
import { synthesizeStream } from "./synthesize.js"
import { libraryRegistry } from "./registry.js"
import { makeLoweringCache } from "./lowering-cache.js"
import pkg from "../../package.json"

const SUPPORTED_TARGETS = ["javascript", "python"]
const DEFAULT_SYNC_TIMEOUT_MS = 5000

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
const delay = ms => new Promise(r => setTimeout(r, ms))

// "lists@1.0.0" -> { name, version }; a bare "lists" resolves to the latest version.
function parseLibraryRef(ref) {
  const [name, version = "latest"] = ref.split("@")
  return { name, version }
}

// Which manifest primitives the synthesized program actually calls.
function harnessSummary(manifest, program, version) {
  const declared = new Set(manifest.primitives.map(p => p.name))
  const used = new Set()
  for (const clause of program.clauses)
    for (const goal of clause.body) if (declared.has(goal.predicate)) used.add(goal.predicate)
  return { library: manifest.library, version, primitives_used: [...used], semantic_hash: manifest.semantic_hash ?? null }
}

// Assemble the full solution from a terminal search result: program (always), lowerings
// for requested targets, per-example proof, harness summary, and stats.
function buildSolution(result, spec, lowerFn) {
  const { problem, manifest, background, targets, resolvedVersion } = spec
  const program = result.program
  const out = { program, lowerings: {}, proof: [], harness_manifest: null, stats: result.stats }
  if (!program) return out

  const examples = { positives: problem.positives, negatives: problem.negatives }
  const v = verify(program, background, examples, { maxDepth: problem.bias.max_recursion_depth })
  out.proof = [...v.positives, ...v.negatives].map(e => ({ example: e.example, covers: e.covered, trace: e.proof }))
  out.harness_manifest = harnessSummary(manifest, program, resolvedVersion)

  const headModes = Object.fromEntries((problem.bias.head_predicates ?? []).filter(p => p.mode).map(p => [p.name, p.mode]))
  for (const target of targets) {
    // Lowered source is deterministic, so identical (program, target, harness) lowerings
    // come from the cache rather than being recomputed.
    const { source, metadata } = lowerFn(program, manifest, { target, modes: headModes })
    out.lowerings[target] = { source, feasibility: metadata.feasibility, caveats: metadata.caveats, reason: metadata.reason }
  }
  return out
}

async function capabilities(registry, version) {
  const byName = libraryIndex(await registry.list())
  return json({
    engine_version: version,
    supported_targets: SUPPORTED_TARGETS,
    available_libraries: byName,
    typical_latency_ms: { p50: null, p95: null }, // not measured by the MVP
    features: { streaming: true, clarification: false, target_biased_synthesis: false }
  })
}

function libraryIndex(entries) {
  const byName = new Map()
  for (const { library, version } of entries) {
    if (!byName.has(library)) byName.set(library, [])
    byName.get(library).push(version)
  }
  return [...byName].map(([name, versions]) => ({ name, versions }))
}

async function getLibrary(registry, name, version) {
  let manifest
  try { manifest = await registry.manifest(name, version) }
  catch (e) { return json({ error: e.message }, 404) }
  const implementations = {}
  for (const target of SUPPORTED_TARGETS) {
    try { implementations[target] = await registry.implementationSource(name, manifest.version, target) }
    catch { /* a target without an implementation file is simply absent */ }
  }
  return json({ manifest, implementations })
}

export function makeHandler(options = {}) {
  const registry = libraryRegistry(options.registryRoot ?? "libraries")
  const version = options.engineVersion ?? pkg.version
  const syncTimeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS
  const loweringCache = options.loweringCache ?? makeLoweringCache()
  const jobs = new Map()

  const notify = (job, event, data) => { for (const sub of [...job.subscribers]) sub(event, data) }

  async function runJob(job, spec) {
    try {
      let terminal
      for await (const step of synthesizeStream(spec.fullProblem)) {
        if (step.done) { terminal = step.solution; break }
        if (step.improved) {
          const partial = { program: step.solution.program, stats: step.solution.stats }
          job.partials.push(partial)
          notify(job, "partial", partial)
        }
      }
      job.solution = buildSolution(terminal, spec, loweringCache.lower)
      job.status = "complete"
      notify(job, "complete", job.solution)
    } catch (e) {
      job.error = e.message
      job.status = "error"
      notify(job, "error", { error: e.message })
    }
  }

  function startJob(spec) {
    const id = crypto.randomUUID()
    const job = { id, status: "pending", solution: null, error: null, partials: [], subscribers: new Set() }
    jobs.set(id, job)
    job.promise = runJob(job, spec)
    return job
  }

  async function doSynthesize(request) {
    let body
    try { body = await request.json() }
    catch { return json({ error: "invalid JSON body" }, 400) }

    const { problem, library, budget, targets = [], options: reqOptions = {} } = body ?? {}
    if (!problem) return json({ error: "problem is required" }, 400)
    if (!budget) return json({ error: "budget is required" }, 400)
    if (!library) return json({ error: "library is required" }, 400)
    for (const t of targets)
      if (!SUPPORTED_TARGETS.includes(t)) return json({ error: `unsupported target "${t}"` }, 400)

    const { name, version: ref } = parseLibraryRef(library)
    let loaded
    try { loaded = await registry.load(name, ref) }
    catch (e) { return json({ error: `library: ${e.message}` }, 404) }
    const { manifest, registry: background, version: resolvedVersion } = loaded

    const fullProblem = {
      ...problem,
      background,
      max_time_ms: budget.max_time_ms,
      max_candidates: budget.max_candidates,
      target_coverage: budget.target_coverage,
      ...(reqOptions.noise_tolerance !== undefined ? { noise_tolerance: reqOptions.noise_tolerance } : {})
    }
    const spec = { problem, fullProblem, manifest, background, targets, resolvedVersion }
    const job = startJob(spec)
    const pending = () => json({ status: "pending", job_id: job.id, status_url: `/v1/jobs/${job.id}` }, 202)

    // Prefer: respond-sync waits up to syncTimeoutMs for completion, then falls back.
    const prefersSync = (request.headers.get("prefer") ?? "").includes("respond-sync")
    if (prefersSync && syncTimeoutMs > 0) {
      const outcome = await Promise.race([job.promise.then(() => "done"), delay(syncTimeoutMs).then(() => "timeout")])
      if (outcome === "done" && job.status === "complete") return json({ status: "complete", solution: job.solution })
      if (outcome === "done" && job.status === "error") return json({ status: "error", error: job.error }, 500)
    }
    return pending()
  }

  function getJob(id) {
    const job = jobs.get(id)
    if (!job) return json({ error: "no such job" }, 404)
    if (job.status === "complete") return json({ status: "complete", solution: job.solution })
    if (job.status === "error") return json({ status: "error", error: job.error }, 500)
    return json({ status: "pending", job_id: id, status_url: `/v1/jobs/${id}` })
  }

  function streamJob(id) {
    const job = jobs.get(id)
    if (!job) return json({ error: "no such job" }, 404)
    let sub
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder()
        const send = (event, data) => {
          try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { /* closed */ }
        }
        for (const p of job.partials) send("partial", p)
        if (job.status === "complete") { send("complete", job.solution); controller.close(); return }
        if (job.status === "error") { send("error", { error: job.error }); controller.close(); return }
        sub = (event, data) => {
          send(event, data)
          if (event === "complete" || event === "error") { job.subscribers.delete(sub); try { controller.close() } catch { /* already closed */ } }
        }
        job.subscribers.add(sub)
      },
      cancel() { if (sub) job.subscribers.delete(sub) } // client hung up: stop sending, leave the job running
    })
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } })
  }

  return async function handle(request) {
    const { pathname } = new URL(request.url)
    const seg = pathname.split("/").filter(Boolean) // ["v1","jobs","<id>","stream"]

    if (request.method === "GET" && pathname === "/v1/capabilities") return capabilities(registry, version)
    if (request.method === "GET" && pathname === "/v1/libraries") return json({ libraries: libraryIndex(await registry.list()) })
    if (request.method === "GET" && seg[0] === "v1" && seg[1] === "libraries" && seg[2])
      return getLibrary(registry, seg[2], seg[3] ?? "latest")
    if (request.method === "GET" && seg[0] === "v1" && seg[1] === "jobs" && seg[2])
      return seg[3] === "stream" ? streamJob(seg[2]) : getJob(seg[2])
    if (request.method === "POST" && pathname === "/v1/synthesize") return doSynthesize(request)

    return json({ error: "not found" }, 404)
  }
}

export function serve(options = {}) {
  return Bun.serve({ port: options.port ?? 8787, fetch: makeHandler(options) })
}
