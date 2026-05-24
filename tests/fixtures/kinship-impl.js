// The JavaScript implementation of the kinship manifest. A real implementation also
// records the manifest hash it targets (`export const semantic_hash = "sha256:..."`);
// the tests stamp it with the computed hash so the fixture never goes stale.

import { unify, applySubstitution } from "../../src/core/unify.js"

const PARENTS = [["tom", "bob"], ["bob", "ann"], ["bob", "pat"], ["pat", "jim"]]

export const predicates = {
  *parent(args, sub) {
    for (const [p, c] of PARENTS) {
      let s = unify(args[0], { type: "const", value: p }, sub)
      if (s === null) continue
      s = unify(args[1], { type: "const", value: c }, s)
      if (s !== null) yield s
    }
  },
  eq(args, sub) {
    const a = applySubstitution(args[0], sub)
    const b = applySubstitution(args[1], sub)
    return JSON.stringify(a) === JSON.stringify(b)
  }
}
