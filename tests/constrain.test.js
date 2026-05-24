import { test, expect } from "bun:test"
import { canonicalProgram, subsumes, makeConstraints } from "../src/engine/constrain.js"
import { synthesize } from "../src/engine/synthesize.js"
import { applySubstitution } from "../src/core/unify.js"

const inSet = set => (args, sub) => {
  const a = applySubstitution(args[0], sub)
  return a.type === "const" && set.includes(a.value)
}

const V = name => ({ type: "var", name })
const atom = (predicate, ...args) => ({ predicate, args })
const clause = (head, ...body) => ({ head, body })
const prog = (...clauses) => ({ clauses })

const bias = {
  head_predicates: [{ name: "t", arity: 1 }],
  body_predicates: [{ name: "p", arity: 1 }, { name: "q", arity: 1 }]
}
const cov = (pos, neg) => ({
  positives: pos.map(covered => ({ covered })),
  negatives: neg.map(covered => ({ covered }))
})

const tp = clause(atom("t", V("V0")), atom("p", V("V0")))
const tq = clause(atom("t", V("V0")), atom("q", V("V0")))

test("canonical form is invariant to clause order and body-variable renaming", () => {
  expect(canonicalProgram(prog(tp, tq))).toBe(canonicalProgram(prog(tq, tp)))
  const a = clause(atom("r", V("V0")), atom("e", V("V0"), V("V1")))
  const b = clause(atom("r", V("V0")), atom("e", V("V0"), V("V2")))
  expect(canonicalProgram(prog(a))).toBe(canonicalProgram(prog(b)))
})

test("canonical form distinguishes head-argument order", () => {
  const a = clause(atom("r", V("V0"), V("V1")), atom("e", V("V0"), V("V1")))
  const b = clause(atom("r", V("V0"), V("V1")), atom("e", V("V1"), V("V0")))
  expect(canonicalProgram(prog(a))).not.toBe(canonicalProgram(prog(b)))
})

test("subsumes: a clause subsumes its body-supersets", () => {
  const tpq = clause(atom("t", V("V0")), atom("p", V("V0")), atom("q", V("V0")))
  expect(subsumes(tp, tpq)).toBe(true)  // t:-p is more general than t:-p,q
  expect(subsumes(tp, tq)).toBe(false)  // t:-p does not subsume t:-q
})

test("redundant: a program equal up to renaming is pruned once seen", () => {
  const c = makeConstraints({ bias, noise_tolerance: 0 })
  c.learn(prog(tp), cov([true], []))
  expect(c.prune(prog(tp))).toBe(true)   // already seen
  expect(c.prune(prog(tq))).toBe(false)  // distinct
})

test("too_general: clause-supersets of an over-covering program are pruned", () => {
  const c = makeConstraints({ bias, noise_tolerance: 0 })
  c.learn(prog(tp), cov([true], [true])) // covers a negative
  expect(c.prune(prog(tp, tq))).toBe(true)  // superset still over-covers
  expect(c.prune(prog(tq))).toBe(false)
})

test("too_specific: specializations of an under-covering clause are pruned", () => {
  const c = makeConstraints({ bias, noise_tolerance: 0 })
  const tpq = clause(atom("t", V("V0")), atom("p", V("V0")), atom("q", V("V0")))
  c.learn(prog(tp), cov([false], [])) // misses a positive
  expect(c.prune(prog(tpq))).toBe(true)  // adding a literal can't recover it
  expect(c.prune(prog(tq))).toBe(false)  // unrelated clause
})

test("unsatisfiable: a type-conflicted clause is pruned", () => {
  const typedBias = {
    head_predicates: [{ name: "t", arity: 1, arg_types: ["color"] }],
    body_predicates: [
      { name: "col", arity: 1, arg_types: ["color"] },
      { name: "num", arity: 1, arg_types: ["number"] }
    ]
  }
  const c = makeConstraints({ bias: typedBias, noise_tolerance: 0 })
  const conflict = clause(atom("t", V("V0")), atom("col", V("V0")), atom("num", V("V0")))
  const ok = clause(atom("t", V("V0")), atom("col", V("V0")))
  expect(c.prune(prog(conflict))).toBe(true)
  expect(c.prune(prog(ok))).toBe(false)
})

test("constraints cut tested candidates while finding the same program", async () => {
  // The answer needs two clauses (t:-p covers 1, t:-q covers 2); single clauses
  // either over-cover the negative or miss a positive. too_general prunes every
  // two-clause program built on the over-covering fact.
  const C = value => ({ type: "const", value })
  const problem = {
    bias: {
      head_predicates: [{ name: "t", arity: 1 }],
      body_predicates: [{ name: "p", arity: 1 }, { name: "q", arity: 1 }],
      max_clauses: 2, max_body_length: 1, max_variables: 1, max_recursion_depth: 1, allow_recursion: false
    },
    background: { p: inSet([1]), q: inSet([2]) },
    positives: [atom("t", C(1)), atom("t", C(2))],
    negatives: [atom("t", C(3))]
  }
  const off = await synthesize(problem, { constraints: false })
  const on = await synthesize(problem) // constraints on by default

  expect(off.stats.found).toBe(true)
  expect(on.stats.found).toBe(true)
  expect(on.coverage.correct).toBe(true)
  expect(canonicalProgram(on.program)).toBe(canonicalProgram(off.program))
  expect(on.stats.candidates_tested).toBeLessThan(off.stats.candidates_tested)
  expect(on.stats.candidates_pruned).toBe(2)
})
