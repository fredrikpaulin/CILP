import { test, expect } from "bun:test"
import { synthesize } from "../src/engine/synthesize.js"
import { applySubstitution } from "../src/core/unify.js"
import { boardRegistry } from "./fixtures/tictactoe.js"

const inSet = set => (args, sub) => {
  const a = applySubstitution(args[0], sub)
  return a.type === "const" && set.includes(a.value)
}

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

const bias = {
  head_predicates: [{ name: "wins", arity: 1 }],
  body_predicates: [
    { name: "line", arity: 3 },
    { name: "cell", arity: 2 },
    { name: "eq", arity: 2 }
  ],
  max_clauses: 1,
  max_body_length: 5,
  max_variables: 5,
  max_recursion_depth: 3,
  allow_recursion: false
}

// wins(P) :- line(A,B,C), cell(A,M), cell(B,M), cell(C,M), eq(M,P).
const winRule = {
  clauses: [{
    head: atom("wins", V("P")),
    body: [
      atom("line", V("A"), V("B"), V("C")),
      atom("cell", V("A"), V("M")),
      atom("cell", V("B"), V("M")),
      atom("cell", V("C"), V("M")),
      atom("eq", V("M"), V("P"))
    ]
  }]
}
// wins(P) :- cell(A, P).  too general — succeeds for any occupied mark
const tooGeneral = {
  clauses: [{ head: atom("wins", V("P")), body: [atom("cell", V("A"), V("P"))] }]
}

const xWins = [[1, "x"], [5, "x"], [9, "x"], [2, "o"], [3, "o"]]
const problemFor = (board, extra = {}) => ({
  bias,
  background: boardRegistry(board),
  positives: [atom("wins", C("x"))],
  negatives: [atom("wins", C("o"))],
  ...extra
})

test("rejects a malformed problem", async () => {
  await expect(synthesize({})).rejects.toThrow(/invalid problem/)
})

test("the default enumerator reports an exhausted search when nothing fits", async () => {
  const problem = {
    bias: {
      head_predicates: [{ name: "t", arity: 1 }],
      body_predicates: [{ name: "p", arity: 1 }],
      max_clauses: 1, max_body_length: 1, max_variables: 1, max_recursion_depth: 1, allow_recursion: false
    },
    background: { p: inSet([1]) },
    positives: [atom("t", C(2))],
    negatives: [atom("t", C(1))]
  }
  const sol = await synthesize(problem)
  expect(sol.stats.found).toBe(false)
  expect(sol.stats.search_exhausted).toBe(true)
  expect(sol.stats.candidates_tested).toBe(2) // fact, and t :- p
})

test("returns the first acceptable program from the enumerator", async () => {
  const sol = await synthesize(problemFor(xWins), {
    enumerate: function* () { yield tooGeneral; yield winRule }
  })
  expect(sol.stats.found).toBe(true)
  expect(sol.program).toEqual(winRule)
  expect(sol.coverage.correct).toBe(true)
  expect(sol.stats.candidates_tested).toBe(2)
})

test("respects the max_candidates budget", async () => {
  const sol = await synthesize(problemFor(xWins, { max_candidates: 1 }), {
    enumerate: function* () { yield tooGeneral; yield winRule }
  })
  expect(sol.stats.candidates_tested).toBe(1)
  expect(sol.stats.found).toBe(false)
  expect(sol.stats.search_exhausted).toBe(false)
})

test("noise_tolerance admits a candidate that covers a negative", async () => {
  const enumerate = function* () { yield tooGeneral }
  const strict = await synthesize(problemFor(xWins), { enumerate })
  expect(strict.stats.found).toBe(false)
  const lenient = await synthesize(problemFor(xWins, { noise_tolerance: 1 }), { enumerate })
  expect(lenient.stats.found).toBe(true)
  expect(lenient.program).toEqual(tooGeneral)
})

test("target_coverage admits a partial-coverage candidate", async () => {
  // Both wins(x) and wins(o) as positives; the win rule covers only wins(x) here.
  const base = {
    bias,
    background: boardRegistry(xWins),
    positives: [atom("wins", C("x")), atom("wins", C("o"))],
    negatives: []
  }
  const enumerate = function* () { yield winRule }
  const strict = await synthesize(base, { enumerate })
  expect(strict.stats.found).toBe(false) // 1 of 2 < 1.0
  const half = await synthesize({ ...base, target_coverage: 0.5 }, { enumerate })
  expect(half.stats.found).toBe(true) // 1 of 2 >= 0.5
})

test("the JSON program is present unconditionally in the output", async () => {
  // Found: program is the synthesized JSON program.
  const found = await synthesize(problemFor(xWins), {
    enumerate: function* () { yield winRule }
  })
  expect("program" in found).toBe(true)
  expect(found.program).toEqual(winRule)

  // Not found but a best candidate exists: program is the best seen, never dropped.
  const best = await synthesize(problemFor(xWins), {
    enumerate: function* () { yield tooGeneral }
  })
  expect("program" in best).toBe(true)
  expect(best.stats.found).toBe(false)
  expect(best.program).toEqual(tooGeneral)

  // Nothing enumerated: program is present and null, not absent.
  const none = await synthesize(problemFor(xWins), { enumerate: function* () {} })
  expect("program" in none).toBe(true)
  expect(none.program).toBeNull()
})

test("loads background from a module path string", async () => {
  const grandparent = {
    clauses: [{
      head: atom("grandparent", V("X"), V("Z")),
      body: [atom("parent", V("X"), V("Y")), atom("parent", V("Y"), V("Z"))]
    }]
  }
  const problem = {
    bias: {
      head_predicates: [{ name: "grandparent", arity: 2 }],
      body_predicates: [{ name: "parent", arity: 2 }],
      max_clauses: 1, max_body_length: 2, max_variables: 3, max_recursion_depth: 3, allow_recursion: false
    },
    background: new URL("./fixtures/family.js", import.meta.url).href,
    positives: [atom("grandparent", C("tom"), C("ann"))],
    negatives: [atom("grandparent", C("tom"), C("jim"))] // great-grandchild, not grandchild
  }
  const sol = await synthesize(problem, { enumerate: function* () { yield grandparent } })
  expect(sol.stats.found).toBe(true)
  expect(sol.coverage.correct).toBe(true)
})
