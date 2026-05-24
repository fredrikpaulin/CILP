// Hand-built demo tasks. Outputs are derived from inputs by the transform itself, so
// they can't drift. Each task carries a tight per-task bias selecting just the
// predicates its rule needs — the per-task bias that #019 will eventually generate.
//
// `tractable: true` means synthesis finds the rule within a small budget on the CPU
// (body-length-1 geometric transforms over the variable-only space). Transforms that
// need a body-2 rule over arity-4 predicates blow up the naive enumerator; they are
// marked tractable: false and demonstrated by applying a known rule rather than
// synthesizing it, until GPU-in-search (#035), mode constraints, or Path B land.

import { biasFor } from "./task.js"

// 3×3 inputs over three colours (keeps the negative set, hence the search, small).
const A = [[1, 2, 0], [0, 1, 2], [2, 0, 1]]
const B = [[2, 1, 0], [1, 0, 2], [0, 2, 1]]
const TEST = [[0, 1, 2], [2, 0, 1], [1, 2, 0]]

const transpose = rows => rows[0].map((_, c) => rows.map(r => r[c]))
const mirrorX = rows => rows.map(r => [...r].reverse())

const pair = (input, f) => ({ input, output: f(input) })

export const identityTask = {
  name: "identity",
  tractable: true,
  bias: biasFor(["cell"], { max_body_length: 1, max_variables: 4 }),
  train: [pair(A, r => r), pair(B, r => r)],
  test: { input: TEST, output: TEST }
}

export const transposeTask = {
  name: "transpose",
  tractable: true,
  bias: biasFor(["cell"], { max_body_length: 1, max_variables: 4 }),
  train: [pair(A, transpose), pair(B, transpose)],
  test: { input: TEST, output: transpose(TEST) }
}

export const mirrorXTask = {
  name: "mirror_x",
  tractable: false, // needs output(G,X,Y,C) :- cell(G,X2,Y,C), mirror_x(G,X,X2) — a body-2 rule
  bias: biasFor(["cell", "mirror_x"], { max_body_length: 2, max_variables: 5 }),
  train: [pair(A, mirrorX), pair(B, mirrorX)],
  test: { input: TEST, output: mirrorX(TEST) }
}

export const tasks = [identityTask, transposeTask, mirrorXTask]
