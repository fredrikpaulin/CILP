import { test, expect } from "bun:test"
import { gridFromRows, sameGrid } from "../applications/arc/grid.js"
import { arcBackground } from "../applications/arc/library.js"
import { toProblem, applyRule, solveTask } from "../applications/arc/task.js"
import { identityTask, transposeTask, mirrorXTask } from "../applications/arc/tasks.js"

const C = value => ({ type: "const", value })
// Direct registry.solve calls need normalized (id-bearing) query variables; via
// interpret they're normalized automatically.
const V = (name, id) => ({ type: "var", name, id })
const atom = (predicate, ...args) => ({ predicate, args })
const all = (reg, name, args) => [...reg.solve(name, args, new Map())]

test("library: cell, mirror_x, count_of, component on a known grid", () => {
  // 2×2: a solid colour-0 block and a colour-1 corner
  const reg = arcBackground({ g: gridFromRows([[0, 0], [0, 1]]) })

  // cell(g, 1, 1, C) → exactly one colour
  expect(all(reg, "cell", [C("g"), C(1), C(1), V("C", 0)]).length).toBe(1)

  // mirror_x(g, 0, X) → width-1 = 1
  expect(all(reg, "mirror_x", [C("g"), C(0), V("X", 0)]).length).toBe(1)

  // count_of(g, 0, N) → one count entry for colour 0
  expect(all(reg, "count_of", [C("g"), C(0), V("N", 0)]).length).toBe(1)

  // 4 cells, each with a component id
  expect(all(reg, "component", [C("g"), V("X", 0), V("Y", 1), V("Id", 2)]).length).toBe(4)

  // two components → two bounding boxes
  const bboxes = all(reg, "bounding_box", [C("g"), V("Id", 0), V("X1", 1), V("Y1", 2), V("X2", 3), V("Y2", 4)])
  expect(bboxes.length).toBe(2)
})

test("toProblem produces output-cell positives and wrong-colour negatives", () => {
  const { problem } = toProblem(identityTask, identityTask.bias)
  // 2 train pairs × 9 cells = 18 positive output cells
  expect(problem.positives.length).toBe(18)
  // 3 colours appear, so each cell contributes 2 wrong-colour negatives
  expect(problem.negatives.length).toBe(36)
})

test("synthesizes the identity transform end to end", async () => {
  const sol = await solveTask(identityTask, identityTask.bias, { max_candidates: 3000 })
  expect(sol.stats.found).toBe(true)
  expect(sol.correct).toBe(true)
})

test("synthesizes the transpose transform end to end", async () => {
  const sol = await solveTask(transposeTask, transposeTask.bias, { max_candidates: 3000 })
  expect(sol.stats.found).toBe(true)
  expect(sol.correct).toBe(true)
})

test("a hand-given mirror_x rule applies correctly (synthesis of it is beyond naive search)", () => {
  // output(G,X,Y,C) :- cell(G,X2,Y,C), mirror_x(G,X,X2)
  const mirrorRule = {
    clauses: [{
      head: atom("output", V("G"), V("X"), V("Y"), V("C")),
      body: [
        atom("cell", V("G"), V("X2"), V("Y"), V("C")),
        atom("mirror_x", V("G"), V("X"), V("X2"))
      ]
    }]
  }
  const { registry, grids } = toProblem(mirrorXTask, mirrorXTask.bias)
  const predicted = applyRule(mirrorRule, registry, "test", grids.test.width, grids.test.height)
  const expected = gridFromRows(mirrorXTask.test.output)
  expect(sameGrid(predicted, expected)).toBe(true)
  expect(mirrorXTask.tractable).toBe(false) // documents the limit
})
