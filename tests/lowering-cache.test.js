import { test, expect } from "bun:test"
import { makeLoweringCache, makeHandler } from "../src/engine/index.js"
import { lower } from "../src/core/index.js"

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })
const clause = (head, ...body) => ({ head, body })

const gp = { clauses: [clause(atom("gp", V("X"), V("Z")), atom("parent", V("X"), V("Y")), atom("parent", V("Y"), V("Z")))] }
const modes = { gp: ["in", "out"], parent: ["in", "out"] }

// A lower that counts how often the real lowering actually runs.
function counting() {
  const calls = []
  const fn = (program, harness, options) => { calls.push(options.target); return lower(program, harness, options) }
  fn.calls = calls
  return fn
}

test("a cache hit returns identical output and skips re-lowering", () => {
  const real = counting()
  const cache = makeLoweringCache(real)
  const first = cache.lower(gp, null, { target: "sql" })
  const second = cache.lower(gp, null, { target: "sql" })
  expect(real.calls.length).toBe(1)           // the real lowering ran once
  expect(cache.stats).toEqual({ hits: 1, misses: 1 })
  expect(second).toBe(first)                   // same object, not recomputed
  expect(second.source).toBe(lower(gp, null, { target: "sql" }).source) // identical to fresh
})

test("the key separates target, options, and program", () => {
  const real = counting()
  const cache = makeLoweringCache(real)
  cache.lower(gp, null, { target: "sql" })
  cache.lower(gp, null, { target: "javascript", modes })       // different target -> miss
  cache.lower(gp, null, { target: "javascript", modes: { gp: ["out", "in"], parent: ["in", "out"] } }) // different modes -> miss
  const other = { clauses: [clause(atom("p", V("A")), atom("parent", V("A"), V("B")))] }
  cache.lower(other, null, { target: "sql" })                  // different program -> miss
  expect(cache.stats.misses).toBe(4)
  expect(cache.stats.hits).toBe(0)
  expect(cache.size).toBe(4)
})

test("the harness identity is part of the key", () => {
  const real = counting()
  const cache = makeLoweringCache(real)
  cache.lower(gp, { semantic_hash: "sha256:aaa", primitives: [] }, { target: "sql" })
  cache.lower(gp, { semantic_hash: "sha256:bbb", primitives: [] }, { target: "sql" })
  expect(cache.stats.misses).toBe(2) // different harnesses, even with the same program
})

test("the server lowers a repeated program only once (cache hit across requests)", async () => {
  const real = counting()
  const handle = makeHandler({
    registryRoot: `${import.meta.dir}/../libraries`,
    loweringCache: makeLoweringCache(real)
  })
  const nil = { type: "compound", functor: "nil", args: [] }
  const cons = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })
  const request = {
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
  const post = () => handle(new Request("http://t/v1/synthesize", { method: "POST", body: JSON.stringify(request), headers: { prefer: "respond-sync" } }))
  const a = await (await post()).json()
  const b = await (await post()).json()
  // Same synthesized program both times → the javascript lowering ran once, then hit.
  expect(real.calls).toEqual(["javascript"])
  expect(a.solution.lowerings.javascript.source).toBe(b.solution.lowerings.javascript.source)
})
