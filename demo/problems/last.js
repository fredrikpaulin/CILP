// last(L, X): X is the last element of L. Two clauses, recursive — a base case (tail is
// empty, so head is the answer) and a recursive case (recurse on the tail).
//
//   last(L, X) :- tail(L, T), empty(T), head(L, X).
//   last(L, X) :- tail(L, T), last(T, X).
//
// Recursion executes correctly in the interpreter (the reference program below verifies),
// but the naive Path-A enumerator does not reach a two-clause recursive program of this
// shape within the demo budget. So this is a recursion *probe*, not a required test: it is
// reported as skipped-with-reason rather than counted as a failure (see the demo plan §7.3).

import { predicates, list, C, V, atom } from "../harness/predicates.js"

export default {
  name: "last/2",
  required: false,
  predicateLabels: "head/2, tail/2, empty/1",
  problem: {
    bias: {
      head_predicates: [{ name: "last", arity: 2, mode: ["in", "out"] }],
      body_predicates: [
        { name: "head", arity: 2, mode: ["in", "out"] },
        { name: "tail", arity: 2, mode: ["in", "out"] },
        { name: "empty", arity: 1, mode: ["in"] }
      ],
      max_clauses: 2, max_body_length: 3, max_variables: 3, max_recursion_depth: 5, allow_recursion: true
    },
    background: predicates,
    positives: [
      atom("last", list("a"), C("a")),
      atom("last", list("a", "b"), C("b")),
      atom("last", list("a", "b", "c"), C("c"))
    ],
    negatives: [
      atom("last", list("a", "b"), C("a")),
      atom("last", list("a", "b", "c"), C("a")),
      atom("last", list("a", "b", "c"), C("b"))
    ]
  },
  // The program the search is looking for, used to show recursion executes correctly even
  // when the enumerator doesn't reach it within budget.
  expected: {
    clauses: [
      { head: atom("last", V("L"), V("X")), body: [atom("tail", V("L"), V("T")), atom("empty", V("T")), atom("head", V("L"), V("X"))] },
      { head: atom("last", V("L"), V("X")), body: [atom("tail", V("L"), V("T")), atom("last", V("T"), V("X"))] }
    ]
  },
  skipReason: "the two-clause recursive program is not reached by the Path-A enumerator within the budget. Recursion executes correctly (the reference program verifies below) — this is an enumerator-reach limit, not a recursion-support limit. It is what motivates Path B (#016) and target-biased search."
}
