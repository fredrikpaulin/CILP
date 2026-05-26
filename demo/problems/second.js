// second(L, X): X is the second element of the list L. One clause, no recursion —
// composes tail and head on a shared variable. The minimum viable synthesis test.
//
//   second(L, X) :- tail(L, T), head(T, X).

import { predicates, list, C, atom } from "../harness/predicates.js"

export default {
  name: "second/2",
  required: true,
  predicateLabels: "head/2, tail/2",
  problem: {
    bias: {
      head_predicates: [{ name: "second", arity: 2, mode: ["in", "out"] }],
      body_predicates: [
        { name: "tail", arity: 2, mode: ["in", "out"] },
        { name: "head", arity: 2, mode: ["in", "out"] }
      ],
      max_clauses: 1, max_body_length: 2, max_variables: 3, max_recursion_depth: 1, allow_recursion: false
    },
    background: predicates,
    positives: [
      atom("second", list("a", "b"), C("b")),
      atom("second", list("a", "b", "c"), C("b")),
      atom("second", list("x", "y", "z"), C("y"))
    ],
    negatives: [
      atom("second", list("a", "b"), C("a")),
      atom("second", list("a", "b", "c"), C("c")),
      atom("second", list("a", "b", "c"), C("a"))
    ]
  }
}
