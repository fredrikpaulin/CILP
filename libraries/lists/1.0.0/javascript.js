// JavaScript implementation of the `lists` manifest, v1.0.0. Lists are cons/nil
// compound terms: nil is the empty list, cons(H, T) is H prepended to T. An
// implementation records the manifest hash it targets, so a stale build is caught at
// load (see loadHarness); conformance then checks these predicates actually agree with
// the manifest's declared example calls.

import { unify, walk } from "copper-ilp/core"

// The semantic hash this implementation was built against. Recomputed and checked by
// loadHarness; conform() exercises the behaviour the hash only labels.
export const semantic_hash = "sha256:77dd2ac8d319b9de0fa251fcd66acc08d19be0ed4f6272248d25c54984ebf886"

const isCons = t => t.type === "compound" && t.functor === "cons" && t.args.length === 2
const isNil = t => t.type === "compound" && t.functor === "nil" && t.args.length === 0
const consTerm = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })

export const predicates = {
  // cons(H, T, L): L unifies with the list cons(H, T).
  cons(args, sub) {
    return unify(args[2], consTerm(args[0], args[1]), sub) || false
  },
  // head(L, H): H unifies with the first element of a non-empty L.
  head(args, sub) {
    const list = walk(args[0], sub)
    if (!isCons(list)) return false
    return unify(args[1], list.args[0], sub) || false
  },
  // tail(L, T): T unifies with the rest of a non-empty L.
  tail(args, sub) {
    const list = walk(args[0], sub)
    if (!isCons(list)) return false
    return unify(args[1], list.args[1], sub) || false
  },
  // empty(L): L is the empty list.
  empty(args, sub) {
    return isNil(walk(args[0], sub))
  },
  // member(X, L): one solution per element of L.
  *member(args, sub) {
    let list = walk(args[1], sub)
    while (isCons(list)) {
      const s = unify(args[0], list.args[0], sub)
      if (s !== null) yield s
      list = walk(list.args[1], sub)
    }
  }
}
