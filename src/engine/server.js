// The MVP synthesis server. It exposes synthesis as an HTTP service so a field agent
// on hardware that can't run the engine can synthesize remotely. This is the v1.0
// surface and it is synchronous: a request runs the search to completion within its
// budget and returns the result. Async jobs and streaming are a later ticket (#028);
// authentication, rate limiting, and quotas are deployment configuration, not engine
// code, and are out of scope here.
//
// `makeHandler` returns a plain `(Request) => Promise<Response>` so the whole server is
// testable without binding a port; `serve` wraps it in Bun.serve for real use.

import { verify, lower } from "../core/index.js"
import { synthesize } from "./synthesize.js"
import { libraryRegistry } from "./registry.js"
import pkg from "../../package.json"

const SUPPORTED_TARGETS = ["javascript"]

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })

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

async function capabilities(registry, version) {
  const byName = new Map()
  for (const { library, version: v } of await registry.list()) {
    if (!byName.has(library)) byName.set(library, [])
    byName.get(library).push(v)
  }
  return json({
    engine_version: version,
    supported_targets: SUPPORTED_TARGETS,
    available_libraries: [...byName].map(([name, versions]) => ({ name, versions })),
    typical_latency_ms: { p50: null, p95: null }, // not measured by the MVP
    features: { streaming: false, clarification: false, target_biased_synthesis: false }
  })
}

async function listLibraries(registry) {
  const byName = new Map()
  for (const { library, version } of await registry.list()) {
    if (!byName.has(library)) byName.set(library, [])
    byName.get(library).push(version)
  }
  return json({ libraries: [...byName].map(([name, versions]) => ({ name, versions })) })
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

async function doSynthesize(request, registry) {
  let body
  try { body = await request.json() }
  catch { return json({ error: "invalid JSON body" }, 400) }

  const { problem, library, budget, targets = [], options = {} } = body ?? {}
  if (!problem) return json({ error: "problem is required" }, 400)
  if (!budget) return json({ error: "budget is required" }, 400)
  if (!library) return json({ error: "library is required" }, 400)
  for (const t of targets)
    if (!SUPPORTED_TARGETS.includes(t)) return json({ error: `unsupported target "${t}"` }, 400)

  const { name, version } = parseLibraryRef(library)
  let loaded
  try { loaded = await registry.load(name, version) }
  catch (e) { return json({ error: `library: ${e.message}` }, 404) }
  const { manifest, registry: background, version: resolvedVersion } = loaded

  // The agent supplies bias + examples; the resolved library supplies the background and
  // the budget folds into the problem's search controls.
  const fullProblem = {
    ...problem,
    background,
    max_time_ms: budget.max_time_ms,
    max_candidates: budget.max_candidates,
    target_coverage: budget.target_coverage,
    ...(options.noise_tolerance !== undefined ? { noise_tolerance: options.noise_tolerance } : {})
  }

  let result
  try { result = await synthesize(fullProblem) }
  catch (e) { return json({ error: `synthesis: ${e.message}` }, 400) }

  const program = result.program
  const solution = { program, lowerings: {}, proof: [], harness_manifest: null, stats: result.stats }

  if (program) {
    const examples = { positives: problem.positives, negatives: problem.negatives }
    const v = verify(program, background, examples, { maxDepth: problem.bias.max_recursion_depth })
    solution.proof = [...v.positives, ...v.negatives].map(e => ({ example: e.example, covers: e.covered, trace: e.proof }))
    solution.harness_manifest = harnessSummary(manifest, program, resolvedVersion)

    const headModes = Object.fromEntries((problem.bias.head_predicates ?? []).filter(p => p.mode).map(p => [p.name, p.mode]))
    for (const target of targets) {
      const { source, metadata } = lower(program, manifest, { target, modes: headModes, implementation: `./${target}.js` })
      solution.lowerings[target] = { source, feasibility: metadata.feasibility, caveats: metadata.caveats, reason: metadata.reason }
    }
  }

  return json({ status: "complete", solution })
}

export function makeHandler(options = {}) {
  const registry = libraryRegistry(options.registryRoot ?? "libraries")
  const version = options.engineVersion ?? pkg.version

  return async function handle(request) {
    const { pathname } = new URL(request.url)
    const segments = pathname.split("/").filter(Boolean) // ["v1", "libraries", "lists", "1.0.0"]

    if (request.method === "GET" && pathname === "/v1/capabilities") return capabilities(registry, version)
    if (request.method === "GET" && pathname === "/v1/libraries") return listLibraries(registry)
    if (request.method === "GET" && segments[0] === "v1" && segments[1] === "libraries" && segments[2]) {
      return getLibrary(registry, segments[2], segments[3] ?? "latest")
    }
    if (request.method === "POST" && pathname === "/v1/synthesize") return doSynthesize(request, registry)

    return json({ error: "not found" }, 404)
  }
}

export function serve(options = {}) {
  return Bun.serve({ port: options.port ?? 8787, fetch: makeHandler(options) })
}
