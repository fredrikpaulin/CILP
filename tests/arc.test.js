import { test, expect } from "bun:test"
import { gridFromRows } from "../applications/arc/grid.js"
import { arcBackground } from "../applications/arc/library.js"
import { toProblem, solveTask } from "../applications/arc/task.js"
import { identityTask, transposeTask, mirrorXTask, broadcastColumnTask } from "../applications/arc/tasks.js"
import { enumerateClauses } from "../src/engine/enumerate.js"

const C = value => ({ type: "const", value })
// Direct registry.solve calls need normalized (id-bearing) query variables; via
// interpret they're normalized automatically.
const V = (name, id) => ({ type: "var", name, id })
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

test("type-directed enumeration collapses the mirror_x frontier and keeps the answer (#045)", () => {
  const typed = mirrorXTask.bias
  const untyped = JSON.parse(JSON.stringify(typed))
  untyped.head_predicates.forEach(p => delete p.arg_types)
  untyped.body_predicates.forEach(p => delete p.arg_types)

  let typedCount = 0, untypedCount = 0, answerPresent = false
  for (const c of enumerateClauses(typed)) {
    typedCount++
    if (c.body.length === 2 && c.body.some(a => a.predicate === "cell") && c.body.some(a => a.predicate === "mirror_x")) answerPresent = true
  }
  for (const _ of enumerateClauses(untyped)) untypedCount++

  expect(typedCount * 10).toBeLessThan(untypedCount) // types cut the frontier by ~100x
  expect(answerPresent).toBe(true)                   // but never the cell+mirror_x answer
})

test("synthesizes the mirror_x transform end to end (#044/#045)", async () => {
  // The body-2 rule output(G,X,Y,C) :- cell(G,X2,Y,C), mirror_x(G,X,X2) — once beyond reach,
  // now found in tens of candidates thanks to mode- and type-directed enumeration.
  const sol = await solveTask(mirrorXTask, mirrorXTask.bias, { max_candidates: 3000 })
  expect(sol.stats.found).toBe(true)
  expect(sol.correct).toBe(true)
  expect(sol.program.clauses[0].body.map(a => a.predicate).sort()).toEqual(["cell", "mirror_x"])
})

test("synthesizes a constant-bearing rule end to end (#043)", async () => {
  // broadcast column 0: output(G,X,Y,C) :- cell(G,0,Y,C). The literal 0 (a coordinate) in a
  // clause body is what the variable-only space could not express; the typed constants pool
  // makes it reachable.
  const sol = await solveTask(broadcastColumnTask, broadcastColumnTask.bias, { max_candidates: 3000 })
  expect(sol.stats.found).toBe(true)
  expect(sol.correct).toBe(true)
  const body = sol.program.clauses[0].body
  const consts = body.flatMap(a => a.args).filter(t => t.type === "const")
  expect(consts.some(t => t.value === 0)).toBe(true) // the rule actually uses the constant
})
