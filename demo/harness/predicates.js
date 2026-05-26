// The demo's background is the curated `lists` library — the same head/tail/empty/cons/
// member predicates the rest of Copper uses, over cons/nil compound-term lists. The demo
// composes them; it doesn't reimplement them. These helpers build and name terms.

import { predicates } from "../../libraries/lists/1.0.0/javascript.js"

export { predicates }

export const C = value => ({ type: "const", value })
export const V = name => ({ type: "var", name })
export const nil = { type: "compound", functor: "nil", args: [] }
export const cons = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })

// list("a", "b") -> cons("a", cons("b", nil)). Bare values become constants.
export const list = (...xs) => xs.reduceRight((tail, x) => cons(typeof x === "object" ? x : C(x), tail), nil)

export const atom = (predicate, ...args) => ({ predicate, args })
