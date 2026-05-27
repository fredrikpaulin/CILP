// Framing an ARC task as a Copper synthesis problem, and applying the result.
//
// The transformation is learned per output cell: the head is output(G, X, Y, C) —
// "in grid G, cell (X, Y) has colour C in the output." Positives are the true output
// cells; negatives are the same cells with a wrong colour, which is what forces the
// rule to commit to a colour rather than the trivial "any cell, any colour." The
// background describes the input grids, so a rule like output(G,X,Y,C) :- cell(G,X,Y,C)
// (identity) or :- cell(G,Y,X,C) (transpose) generalizes across pairs and the test grid.

import { synthesize } from "../../src/engine/synthesize.js"
import { interpret } from "../../src/core/resolve.js"
import { normalize } from "../../src/core/normalize.js"
import { walk } from "../../src/core/unify.js"
import { arcBackground, ARITY, MODES, TYPES } from "./library.js"
import { gridFromRows, positions, sameGrid } from "./grid.js"

const C = value => ({ type: "const", value })
const V = name => ({ type: "var", name })
const atom = (predicate, ...args) => ({ predicate, args })

// A per-task bias: head output/4, body drawn from the named predicates. Each predicate
// carries its modes (#044) and argument types (#045); a task may declare a constants pool
// (#043) — `opts.constants` is a list of { value, type } the enumerator may place in body
// positions of the matching type.
export function biasFor(bodyNames, opts = {}) {
  const decl = name => ({ name, arity: ARITY[name], mode: MODES[name], arg_types: TYPES[name] })
  return {
    head_predicates: [decl("output")],
    body_predicates: bodyNames.map(decl),
    ...(opts.constants ? { constants: opts.constants } : {}),
    max_clauses: opts.max_clauses ?? 1,
    max_body_length: opts.max_body_length ?? 1,
    max_variables: opts.max_variables ?? 4,
    max_recursion_depth: opts.max_recursion_depth ?? 2,
    allow_recursion: false
  }
}

export function buildGrids(task) {
  const grids = {}
  task.train.forEach((pair, i) => { grids["t" + i] = gridFromRows(pair.input) })
  grids["test"] = gridFromRows(task.test.input)
  return grids
}

export function toProblem(task, bias) {
  const grids = buildGrids(task)
  const registry = arcBackground(grids)

  const outColours = new Set()
  for (const pair of task.train) for (const row of pair.output) for (const c of row) outColours.add(c)

  const positives = []
  const negatives = []
  task.train.forEach((pair, i) => {
    const g = gridFromRows(pair.output)
    for (const [x, y] of positions(g)) {
      const c = g.cells[y * g.width + x]
      positives.push(atom("output", C("t" + i), C(x), C(y), C(c)))
      for (const c2 of outColours) {
        if (c2 !== c) negatives.push(atom("output", C("t" + i), C(x), C(y), C(c2)))
      }
    }
  })

  return { problem: { bias, background: registry, positives, negatives }, registry, grids }
}

// Run a synthesized output/4 rule to produce the grid for `gridId`.
export function applyRule(program, registry, gridId, width, height) {
  const norm = normalize(program).value
  const cells = new Array(width * height).fill(null)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const query = normalize(atom("output", C(gridId), C(x), C(y), V("C"))).value
      for (const sub of interpret(norm, registry, query, { maxDepth: 5 })) {
        const c = walk(query.args[3], sub)
        if (c.type === "const") { cells[y * width + x] = c.value; break }
      }
    }
  }
  return { width, height, cells }
}

export async function solveTask(task, bias, options = {}) {
  const { problem, registry, grids } = toProblem(task, bias)
  const sol = await synthesize(problem, options)
  if (!sol.stats.found) return { program: null, stats: sol.stats, predicted: null, correct: false }
  const test = grids["test"]
  const predicted = applyRule(sol.program, registry, "test", test.width, test.height)
  const expected = task.test.output ? gridFromRows(task.test.output) : null
  return {
    program: sol.program,
    stats: sol.stats,
    predicted,
    correct: expected ? sameGrid(predicted, expected) : null
  }
}
