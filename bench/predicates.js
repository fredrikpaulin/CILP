// Background-predicate helpers for the benchmark suite. `facts` turns a list of
// tuples into a non-deterministic predicate (the foreign-code-over-an-array case);
// `member` turns a set into a deterministic unary test.

import { unify, applySubstitution } from "../src/core/unify.js"

export function facts(tuples) {
  return function* (args, sub) {
    for (const tuple of tuples) {
      let s = sub
      for (let i = 0; i < tuple.length; i++) {
        s = unify(args[i], { type: "const", value: tuple[i] }, s)
        if (s === null) break
      }
      if (s !== null) yield s
    }
  }
}

export function member(values) {
  const set = new Set(values)
  return (args, sub) => {
    const a = applySubstitution(args[0], sub)
    return a.type === "const" && set.has(a.value)
  }
}
