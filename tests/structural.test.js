import { test, expect } from "bun:test"
import { synthesize, structuralCoverage, structuralEvaluator, factPatterns } from "../src/engine/index.js"
import { coverage, makeRegistry } from "../src/core/index.js"

const C = value => ({ type: "const", value })
const V = (name, id) => ({ type: "var", name, id })
const atom = (predicate, ...args) => ({ predicate, args })

// edges out of `a` are positive; an edge out of `b` is the negative. The discriminating
// fact is edge(a, _).
const examples = {
  positives: [atom("edge", C("a"), C("b")), atom("edge", C("a"), C("c"))],
  negatives: [atom("edge", C("b"), C("c"))]
}
const factProblem = {
  bias: { head_predicates: [{ name: "edge", arity: 2 }], body_predicates: [], max_clauses: 1, max_body_length: 0, max_variables: 2, max_recursion_depth: 1, allow_recursion: false },
  background: {},
  positives: examples.positives,
  negatives: examples.negatives,
  max_candidates: 1000, max_time_ms: 5000
}

test("structural coverage agrees with the interpreter on a fact program", () => {
  // edge(a, V1) — covers both positives, excludes the negative.
  const prog = { clauses: [{ head: atom("edge", C("a"), V("V1", 1)), body: [] }] }
  const structural = structuralCoverage(prog, examples)
  const interpreted = coverage(prog, makeRegistry({}), examples)
  expect(structural.correct).toBe(interpreted.correct)
  expect(structural.positives.map(p => p.covered)).toEqual(interpreted.positives.map(p => p.covered))
  expect(structural.negatives.map(n => n.covered)).toEqual(interpreted.negatives.map(n => n.covered))

  // an over-general all-variable fact covers the negative too — not correct.
  const tooGeneral = { clauses: [{ head: atom("edge", V("V0", 0), V("V1", 1)), body: [] }] }
  expect(structuralCoverage(tooGeneral, examples).correct).toBe(false)
})

test("structural coverage rejects clauses with a body (out of the subset)", () => {
  const withBody = { clauses: [{ head: atom("edge", V("V0", 0), V("V1", 1)), body: [atom("node", V("V0", 0))] }] }
  expect(() => structuralCoverage(withBody, examples)).toThrow(/body-less/)
})

test("synthesize with the structural evaluator finds the discriminating pattern", async () => {
  const sol = await synthesize(factProblem, { enumerate: factPatterns, evaluate: structuralEvaluator(examples), constraints: false })
  expect(sol.stats.found).toBe(true)
  expect(sol.program.clauses[0].head.args.map(a => (a.type === "const" ? a.value : "_"))).toEqual(["a", "_"])
})

test("the structural path and the interpreter pick the same program over the same candidates", async () => {
  // Default evaluator (CPU SLD interpreter) vs the packed structural evaluator, same
  // enumerator: identical result is the "same solutions" guarantee for the subset.
  const viaInterpreter = await synthesize(factProblem, { enumerate: factPatterns, constraints: false })
  const viaStructural = await synthesize(factProblem, { enumerate: factPatterns, evaluate: structuralEvaluator(examples), constraints: false })
  expect(viaStructural.program).toEqual(viaInterpreter.program)
})
