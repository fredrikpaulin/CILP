import { test, expect } from "bun:test"
import { synthesize } from "../src/engine/synthesize.js"
import { verify, makeRegistry } from "../src/core/index.js"
import second from "../applications/demo/problems/second.js"
import last from "../applications/demo/problems/last.js"

const BUDGET = { max_candidates: 10000, max_time_ms: 5000 }
const correct = (program, p) =>
  verify(program, makeRegistry(p.problem.background), p.problem, { maxDepth: p.problem.bias.max_recursion_depth }).correct

// The required smoke test: second/2 must synthesize from examples and verify by execution.
test("second/2 synthesizes and the result classifies every example", async () => {
  const sol = await synthesize({ ...second.problem, ...BUDGET })
  expect(sol.stats.found).toBe(true)
  expect(correct(sol.program, second)).toBe(true)
})

// last/2 is a recursion probe, not a required test — but its reference program must
// execute correctly under the interpreter, so the demo's "recursion works" claim is real.
// (We do not assert the enumerator fails to reach it; that limit may lift as search improves.)
test("the last/2 reference program verifies — recursion executes correctly", () => {
  expect(correct(last.expected, last)).toBe(true)
})
