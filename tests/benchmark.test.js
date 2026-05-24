// Phase 2 benchmark: every problem in the suite must synthesize correctly, and
// constraint learning must cut the candidates tested by a measurable margin.

import { test, expect } from "bun:test"
import { synthesize } from "../src/engine/synthesize.js"
import { suite, toProblem } from "../bench/suite.js"

test("every benchmark problem synthesizes a correct program", async () => {
  for (const entry of suite) {
    const sol = await synthesize(toProblem(entry))
    expect(sol.stats.found, `${entry.name} should be solved`).toBe(true)
    expect(sol.coverage.correct, `${entry.name} should be correct`).toBe(true)
  }
})

test("constraint learning yields measurable pruning across the suite", async () => {
  let testedOn = 0
  let testedOff = 0
  let pruned = 0

  for (const entry of suite) {
    const problem = toProblem(entry)
    const on = await synthesize(problem)
    const off = await synthesize(problem, { constraints: false })
    expect(on.stats.found).toBe(true)
    expect(off.stats.found).toBe(true)
    testedOn += on.stats.candidates_tested
    testedOff += off.stats.candidates_tested
    pruned += on.stats.candidates_pruned
  }

  expect(pruned).toBeGreaterThan(0)
  expect(testedOn).toBeLessThan(testedOff)
  expect(testedOff / testedOn).toBeGreaterThanOrEqual(2) // ~4.9x in practice
})
