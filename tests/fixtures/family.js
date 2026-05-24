// A background predicate backed by a plain JS array — the "foreign code" case.
// `parent(P, C)` succeeds for each parent/child pair, binding whichever argument
// is a variable.

import { unify } from "../../src/core/unify.js"

const PARENTS = [
  ["tom", "bob"],
  ["bob", "ann"],
  ["bob", "pat"],
  ["pat", "jim"]
]

export const predicates = {
  *parent(args, sub) {
    for (const [p, c] of PARENTS) {
      let s = unify(args[0], { type: "const", value: p }, sub)
      if (s === null) continue
      s = unify(args[1], { type: "const", value: c }, s)
      if (s === null) continue
      yield s
    }
  }
}
