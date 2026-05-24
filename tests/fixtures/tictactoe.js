// Background for the tic-tac-toe milestone. `line/3` and `eq/2` are board-agnostic;
// `cell/2` is built per board. line and cell are non-deterministic generators; eq
// is a deterministic test (and binds when one side is unbound).

import { unify, walk } from "../../src/core/unify.js"
import { makeRegistry } from "../../src/core/background.js"

const LINES = [
  [1, 2, 3], [4, 5, 6], [7, 8, 9], // rows
  [1, 4, 7], [2, 5, 8], [3, 6, 9], // columns
  [1, 5, 9], [3, 5, 7]             // diagonals
]

const C = value => ({ type: "const", value })

export function boardRegistry(board) {
  return makeRegistry({
    *line(args, sub) {
      for (const [a, b, c] of LINES) {
        let s = unify(args[0], C(a), sub)
        if (s === null) continue
        s = unify(args[1], C(b), s)
        if (s === null) continue
        s = unify(args[2], C(c), s)
        if (s !== null) yield s
      }
    },
    *cell(args, sub) {
      for (const [pos, mark] of board) {
        let s = unify(args[0], C(pos), sub)
        if (s === null) continue
        s = unify(args[1], C(mark), s)
        if (s !== null) yield s
      }
    },
    eq(args, sub) {
      const a = walk(args[0], sub)
      const b = walk(args[1], sub)
      if (a.type === "const" && b.type === "const") return a.value === b.value
      return unify(args[0], args[1], sub) ?? false // bind if one side is unbound
    }
  })
}
