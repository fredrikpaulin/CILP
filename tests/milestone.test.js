// Phase 1 milestone: a hand-written tic-tac-toe win rule, evaluated against
// example boards end to end. Exercises the full executor — normalization,
// resolution, backtracking, and both deterministic (eq) and non-deterministic
// (line, cell) background predicates.

import { test, expect } from "bun:test"
import { coverage } from "../src/core/verify.js"
import { interpret } from "../src/core/resolve.js"
import { normalize } from "../src/core/normalize.js"
import { walk } from "../src/core/unify.js"
import { boardRegistry } from "./fixtures/tictactoe.js"

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

// wins(P) :- line(A, B, C), cell(A, M), cell(B, M), cell(C, M), eq(M, P).
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

test("the win rule classifies a winning board", () => {
  const board = [[1, "x"], [5, "x"], [9, "x"], [2, "o"], [3, "o"]] // x on the diagonal
  const result = coverage(winRule, boardRegistry(board), {
    positives: [atom("wins", C("x"))],
    negatives: [atom("wins", C("o"))]
  })
  expect(result.correct).toBe(true)
  expect(result.positives[0].covered).toBe(true)
  expect(result.negatives[0].covered).toBe(false)
})

test("the win rule covers nothing on a board with no winner", () => {
  const board = [[1, "x"], [2, "o"], [3, "x"], [5, "o"]]
  const result = coverage(winRule, boardRegistry(board), {
    positives: [],
    negatives: [atom("wins", C("x")), atom("wins", C("o"))]
  })
  expect(result.correct).toBe(true)
})

test("a variable query binds to the winning player", () => {
  const board = [[1, "o"], [2, "o"], [3, "o"], [5, "x"]] // o wins the top row
  const program = normalize(winRule).value
  const query = normalize(atom("wins", V("P"))).value
  const winners = [...interpret(program, boardRegistry(board), query)]
    .map(s => walk(query.args[0], s).value)
  expect(winners).toContain("o")
  expect(winners).not.toContain("x")
})
