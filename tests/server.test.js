import { test, expect } from "bun:test"
import { makeHandler } from "../src/engine/server.js"
import { resolve } from "node:path"

const handle = makeHandler({ registryRoot: resolve(import.meta.dir, "../libraries") })

const C = value => ({ type: "const", value })
const nil = { type: "compound", functor: "nil", args: [] }
const cons = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })

const get = path => handle(new Request(`http://t${path}`))
const post = (path, body) => handle(new Request(`http://t${path}`, { method: "POST", body: JSON.stringify(body) }))

// firstof(L, X) :- head(L, X). — a one-clause program the enumerator finds over `lists`.
const firstofRequest = {
  problem: {
    bias: {
      head_predicates: [{ name: "firstof", arity: 2, mode: ["in", "out"] }],
      body_predicates: [{ name: "head", arity: 2 }],
      max_clauses: 1, max_body_length: 1, max_variables: 2, max_recursion_depth: 1, allow_recursion: false
    },
    positives: [{ predicate: "firstof", args: [cons(C(1), nil), C(1)] }],
    negatives: [{ predicate: "firstof", args: [cons(C(1), nil), C(2)] }]
  },
  library: "lists@1.0.0",
  budget: { max_time_ms: 5000, max_candidates: 2000, target_coverage: 1.0 },
  targets: ["javascript"]
}

test("GET /v1/capabilities reports targets, libraries, and v1 feature flags", async () => {
  const res = await get("/v1/capabilities")
  expect(res.status).toBe(200)
  const cap = await res.json()
  expect(typeof cap.engine_version).toBe("string")
  expect(cap.supported_targets).toEqual(["javascript"])
  expect(cap.available_libraries).toContainEqual({ name: "lists", versions: ["1.0.0"] })
  expect(cap.features).toEqual({ streaming: false, clarification: false, target_biased_synthesis: false })
})

test("GET /v1/libraries lists the curated libraries", async () => {
  const { libraries } = await (await get("/v1/libraries")).json()
  expect(libraries).toContainEqual({ name: "lists", versions: ["1.0.0"] })
})

test("GET /v1/libraries/{lib}/{version} serves the manifest and implementation", async () => {
  const res = await get("/v1/libraries/lists/1.0.0")
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.manifest.library).toBe("lists")
  expect(body.implementations.javascript).toContain("export const predicates")
})

test("GET an unknown library is a 404", async () => {
  expect((await get("/v1/libraries/nope/1.0.0")).status).toBe(404)
})

test("POST /v1/synthesize returns program, proof, lowering, harness summary, and stats", async () => {
  const res = await post("/v1/synthesize", firstofRequest)
  expect(res.status).toBe(200)
  const { status, solution } = await res.json()
  expect(status).toBe("complete")

  // program is always present and is the synthesized rule
  expect(solution.program.clauses[0].head.predicate).toBe("firstof")
  expect(solution.stats.found).toBe(true)

  // proof: one entry per example, positives covered, negatives not
  expect(solution.proof.length).toBe(2)
  expect(solution.proof.filter(p => p.covers).length).toBe(1)

  // harness summary names only the primitives actually used
  expect(solution.harness_manifest).toEqual({
    library: "lists", version: "1.0.0", primitives_used: ["head"],
    semantic_hash: expect.stringMatching(/^sha256:/)
  })

  // a requested lowering is present and feasible
  expect(solution.lowerings.javascript.feasibility).toBe("ok")
  expect(solution.lowerings.javascript.source).toContain("export function* lowered_firstof")
})

test("lowerings appear only for requested targets", async () => {
  const { solution } = await (await post("/v1/synthesize", { ...firstofRequest, targets: [] })).json()
  expect(solution.lowerings).toEqual({})
})

test("a synthesize request must carry a budget and a library", async () => {
  const { budget, ...noBudget } = firstofRequest
  expect((await post("/v1/synthesize", noBudget)).status).toBe(400)
  const { library, ...noLibrary } = firstofRequest
  expect((await post("/v1/synthesize", noLibrary)).status).toBe(400)
})

test("an unsupported target is rejected", async () => {
  const res = await post("/v1/synthesize", { ...firstofRequest, targets: ["cobol"] })
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(/unsupported target/)
})

test("an unknown library is a 404 on synthesize", async () => {
  const res = await post("/v1/synthesize", { ...firstofRequest, library: "ghost@9.9.9" })
  expect(res.status).toBe(404)
})

test("unknown routes are 404", async () => {
  expect((await get("/v1/nonsense")).status).toBe(404)
})
