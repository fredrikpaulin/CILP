// The Phase 2 benchmark suite: a set of small, standard ILP problems used to check
// correctness and to measure what constraint learning prunes. Two domains —
// kinship (relations over a family tree) and a successor chain (string-position
// "transformations") — including two recursive targets.

import { facts, member } from "./predicates.js"

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

// --- backgrounds -------------------------------------------------------------

const PARENT = [
  ["tom", "bob"], ["tom", "liz"], ["bob", "ann"], ["bob", "pat"],
  ["pat", "jim"], ["liz", "mia"], ["ann", "ned"]
]
const MALE = ["tom", "bob", "pat", "jim", "ned"]
const FEMALE = ["liz", "ann", "mia"]

const family = { parent: facts(PARENT), male: member(MALE), female: member(FEMALE) }

const NEXT = [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"], ["e", "f"]]
const chain = { next: facts(NEXT) }

// --- bias helper -------------------------------------------------------------

const bias = (head, body, opts = {}) => ({
  head_predicates: [head],
  body_predicates: body,
  max_clauses: opts.max_clauses ?? 1,
  max_body_length: opts.max_body_length ?? 2,
  max_variables: opts.max_variables ?? 3,
  max_recursion_depth: opts.max_recursion_depth ?? 2,
  allow_recursion: opts.allow_recursion ?? false
})

const P = { name: "parent", arity: 2 }
const MALEP = { name: "male", arity: 1 }
const FEMALEP = { name: "female", arity: 1 }
const NEXTP = { name: "next", arity: 2 }

// --- the suite ---------------------------------------------------------------

export const suite = [
  {
    name: "grandparent",
    bias: bias({ name: "grandparent", arity: 2 }, [P]),
    background: family,
    positives: ["tom,ann", "tom,pat", "tom,mia", "bob,jim", "bob,ned"].map(s => pair("grandparent", s)),
    negatives: ["tom,bob", "bob,ann", "tom,jim"].map(s => pair("grandparent", s))
  },
  {
    name: "child",
    bias: bias({ name: "child", arity: 2 }, [P], { max_body_length: 1, max_variables: 2 }),
    background: family,
    positives: ["bob,tom", "ann,bob", "mia,liz"].map(s => pair("child", s)),
    negatives: ["tom,bob", "tom,liz"].map(s => pair("child", s))
  },
  {
    name: "sibling",
    bias: bias({ name: "sibling", arity: 2 }, [P]),
    background: family,
    positives: ["bob,liz", "ann,pat"].map(s => pair("sibling", s)),
    negatives: ["tom,bob", "ann,jim"].map(s => pair("sibling", s))
  },
  {
    name: "father",
    bias: bias({ name: "father", arity: 2 }, [P, MALEP], { max_variables: 2 }),
    background: family,
    positives: ["tom,bob", "bob,ann", "pat,jim"].map(s => pair("father", s)),
    negatives: ["liz,mia", "ann,ned", "tom,ann"].map(s => pair("father", s))
  },
  {
    name: "mother",
    bias: bias({ name: "mother", arity: 2 }, [P, FEMALEP], { max_variables: 2 }),
    background: family,
    positives: ["liz,mia", "ann,ned"].map(s => pair("mother", s)),
    negatives: ["tom,bob", "bob,ann"].map(s => pair("mother", s))
  },
  {
    name: "ancestor",
    bias: bias({ name: "ancestor", arity: 2 }, [P], { allow_recursion: true, max_clauses: 2, max_recursion_depth: 4 }),
    background: family,
    positives: ["tom,bob", "tom,ann", "tom,jim", "bob,jim"].map(s => pair("ancestor", s)),
    negatives: ["bob,tom", "ann,bob", "jim,tom"].map(s => pair("ancestor", s)),
    max_candidates: 50000
  },
  {
    name: "great_grandparent",
    bias: bias({ name: "great_grandparent", arity: 2 }, [P], { max_body_length: 3, max_variables: 4 }),
    background: family,
    positives: ["tom,jim", "tom,ned"].map(s => pair("great_grandparent", s)),
    negatives: ["tom,ann", "bob,jim", "tom,bob"].map(s => pair("great_grandparent", s))
  },
  {
    name: "after_two",
    bias: bias({ name: "after_two", arity: 2 }, [NEXTP]),
    background: chain,
    positives: ["a,c", "b,d", "c,e"].map(s => pair("after_two", s)),
    negatives: ["a,b", "a,d"].map(s => pair("after_two", s))
  },
  {
    name: "after_three",
    bias: bias({ name: "after_three", arity: 2 }, [NEXTP], { max_body_length: 3, max_variables: 4 }),
    background: chain,
    positives: ["a,d", "b,e", "c,f"].map(s => pair("after_three", s)),
    negatives: ["a,c", "a,e"].map(s => pair("after_three", s))
  },
  {
    name: "reachable",
    bias: bias({ name: "reachable", arity: 2 }, [NEXTP], { allow_recursion: true, max_clauses: 2, max_recursion_depth: 6 }),
    background: chain,
    positives: ["a,b", "a,c", "a,f", "c,e"].map(s => pair("reachable", s)),
    negatives: ["b,a", "f,a"].map(s => pair("reachable", s)),
    max_candidates: 50000
  }
]

function pair(predicate, s) {
  const [a, b] = s.split(",")
  return atom(predicate, C(a), C(b))
}

// Build a Problem object for synthesize from a suite entry.
export function toProblem(entry) {
  const { bias, background, positives, negatives, max_candidates } = entry
  const problem = { bias, background, positives, negatives }
  if (max_candidates) problem.max_candidates = max_candidates
  return problem
}
