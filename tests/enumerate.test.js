import { test, expect } from "bun:test"
import { enumerate } from "../src/engine/enumerate.js"
import { synthesize } from "../src/engine/synthesize.js"
import { applySubstitution } from "../src/core/unify.js"

const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

const inSet = set => (args, sub) => {
  const a = applySubstitution(args[0], sub)
  return a.type === "const" && set.includes(a.value)
}

const bodyLength = program => program.clauses[0].body.length
const varCount = program => {
  const names = new Set()
  const visit = t => { if (t.type === "var") names.add(t.name); else if (t.type === "compound") t.args.forEach(visit) }
  const clause = program.clauses[0]
  clause.head.args.forEach(visit)
  clause.body.forEach(a => a.args.forEach(visit))
  return names.size
}

test("enumerates single-clause programs in body-length order, completely", () => {
  const bias = {
    head_predicates: [{ name: "t", arity: 1 }],
    body_predicates: [{ name: "p", arity: 1 }, { name: "q", arity: 1 }],
    max_clauses: 1, max_body_length: 2, max_variables: 1, allow_recursion: false
  }
  const programs = [...enumerate({ bias })]
  // fact; t:-p; t:-q; t:-p,q
  expect(programs.length).toBe(4)
  expect(programs.map(bodyLength)).toEqual([0, 1, 1, 2]) // nondecreasing
})

test("orders by variable count within a body length", () => {
  const bias = {
    head_predicates: [{ name: "t", arity: 1 }],
    body_predicates: [{ name: "e", arity: 2 }],
    max_clauses: 1, max_body_length: 1, max_variables: 2, allow_recursion: false
  }
  const programs = [...enumerate({ bias })]
  // fact (0 body); e(V0,V0) (1 var); e(V0,V1), e(V1,V0), e(V1,V1) (2 vars)
  expect(programs.length).toBe(5)
  const keys = programs.map(p => [bodyLength(p), varCount(p)])
  expect(keys).toEqual([[0, 1], [1, 1], [1, 2], [1, 2], [1, 2]])
  // lexicographically nondecreasing
  for (let i = 1; i < keys.length; i++) {
    const before = keys[i - 1][0] < keys[i][0] || (keys[i - 1][0] === keys[i][0] && keys[i - 1][1] <= keys[i][1])
    expect(before).toBe(true)
  }
})

test("allow_recursion puts the head predicate in the body universe", () => {
  const base = {
    head_predicates: [{ name: "t", arity: 1 }],
    body_predicates: [{ name: "p", arity: 1 }],
    max_clauses: 1, max_body_length: 1, max_variables: 1
  }
  const hasRecursiveBody = programs =>
    programs.some(p => p.clauses[0].body.some(a => a.predicate === "t"))
  expect(hasRecursiveBody([...enumerate({ bias: { ...base, allow_recursion: true } })])).toBe(true)
  expect(hasRecursiveBody([...enumerate({ bias: { ...base, allow_recursion: false } })])).toBe(false)
})

test("orders by clause count, single-clause before multi-clause", () => {
  const bias = {
    head_predicates: [{ name: "t", arity: 1 }],
    body_predicates: [{ name: "p", arity: 1 }, { name: "q", arity: 1 }],
    max_clauses: 2, max_body_length: 2, max_variables: 1, allow_recursion: false
  }
  const programs = [...enumerate({ bias })]
  // 4 single-clause + C(4,2)=6 two-clause = 10
  expect(programs.length).toBe(10)
  const counts = programs.map(p => p.clauses.length)
  expect(counts.slice(0, 4)).toEqual([1, 1, 1, 1])
  expect(counts.slice(4)).toEqual([2, 2, 2, 2, 2, 2])
})

test("the default enumerator drives synthesize to a correct program", async () => {
  const problem = {
    bias: {
      head_predicates: [{ name: "t", arity: 1 }],
      body_predicates: [{ name: "p", arity: 1 }, { name: "q", arity: 1 }],
      max_clauses: 1, max_body_length: 2, max_variables: 1, max_recursion_depth: 1, allow_recursion: false
    },
    background: { p: inSet([1, 2, 3]), q: inSet([2]) },
    positives: [atom("t", C(2))],
    negatives: [atom("t", C(1)), atom("t", C(3))]
  }
  const sol = await synthesize(problem)
  expect(sol.stats.found).toBe(true)
  expect(sol.coverage.correct).toBe(true)
  // the only distinguishing clause is t(V0) :- q(V0)
  expect(sol.program.clauses[0].body).toHaveLength(1)
  expect(sol.program.clauses[0].body[0].predicate).toBe("q")
})
