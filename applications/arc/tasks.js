// Hand-built demo tasks. Outputs are derived from inputs by the transform itself, so
// they can't drift. Each task carries a tight per-task bias selecting just the
// predicates its rule needs — the per-task bias that #019 will eventually generate.
//
// `tractable: true` means synthesis finds the rule within a small budget on the CPU. The
// body-2 rule mirroring needs was once unreachable; mode-directed and connected enumeration
// (#044) reached it slowly, and type-directed enumeration (#045) made it fast — the typed
// frontier is ~100x smaller, so mirror_x now synthesizes in ~70 candidates and is tractable.
// `broadcastColumn` exercises the constants pool (#043): its rule needs a literal coordinate
// in a clause body, which the variable-only space could not express.

import { biasFor } from "./task.js"

// 3×3 inputs over three colours (keeps the negative set, hence the search, small).
const A = [[1, 2, 0], [0, 1, 2], [2, 0, 1]]
const B = [[2, 1, 0], [1, 0, 2], [0, 2, 1]]
const TEST = [[0, 1, 2], [2, 0, 1], [1, 2, 0]]

const transpose = rows => rows[0].map((_, c) => rows.map(r => r[c]))
const mirrorX = rows => rows.map(r => [...r].reverse())
// Every column becomes a copy of column 0: output(x, y) = input(0, y).
const broadcastCol0 = rows => rows.map(r => r.map(() => r[0]))

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
  tractable: true, // output(G,X,Y,C) :- cell(G,X2,Y,C), mirror_x(G,X,X2) — body-2, ~70 candidates with #045
  bias: biasFor(["cell", "mirror_x"], { max_body_length: 2, max_variables: 5 }),
  train: [pair(A, mirrorX), pair(B, mirrorX)],
  test: { input: TEST, output: mirrorX(TEST) }
}

// A constants task: the rule output(G,X,Y,C) :- cell(G,0,Y,C) needs the literal 0 (a
// coordinate) in a clause body — inexpressible in the variable-only space, reachable once the
// bias declares a typed constants pool (#043).
export const broadcastColumnTask = {
  name: "broadcast_column_0",
  tractable: true,
  bias: biasFor(["cell"], {
    max_body_length: 1, max_variables: 4,
    constants: [{ value: 0, type: "coord" }, { value: 1, type: "coord" }, { value: 2, type: "coord" }]
  }),
  train: [pair(A, broadcastCol0), pair(B, broadcastCol0)],
  test: { input: TEST, output: broadcastCol0(TEST) }
}

export const tasks = [identityTask, transposeTask, mirrorXTask, broadcastColumnTask]
