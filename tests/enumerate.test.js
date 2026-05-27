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

test("orders by variable count within a body length, dropping the disconnected clause", () => {
  const bias = {
    head_predicates: [{ name: "t", arity: 1 }],
    body_predicates: [{ name: "e", arity: 2 }],
    max_clauses: 1, max_body_length: 1, max_variables: 2, allow_recursion: false
  }
  const programs = [...enumerate({ bias })]
  // fact (0 body); e(V0,V0) (1 var); e(V0,V1), e(V1,V0) (2 vars). The fifth shape the
  // old variable-only enumerator produced — t(V0) :- e(V1,V1) — is disconnected from the
  // head and pruned by the connectivity bias (#044): its body can't constrain V0.
  expect(programs.length).toBe(4)
  const keys = programs.map(p => [bodyLength(p), varCount(p)])
  expect(keys).toEqual([[0, 1], [1, 1], [1, 2], [1, 2]])
  // lexicographically nondecreasing
  for (let i = 1; i < keys.length; i++) {
    const before = keys[i - 1][0] < keys[i][0] || (keys[i - 1][0] === keys[i][0] && keys[i - 1][1] <= keys[i][1])
    expect(before).toBe(true)
  }
})

test("connectivity prunes clauses whose body shares no variable with the head", () => {
  const bias = {
    head_predicates: [{ name: "t", arity: 1 }],
    body_predicates: [{ name: "e", arity: 2 }],
    max_clauses: 1, max_body_length: 1, max_variables: 2, allow_recursion: false
  }
  const headVars = p => new Set(p.clauses[0].head.args.map(a => a.name))
  const bodyVars = p => new Set(p.clauses[0].body.flatMap(a => a.args.map(x => x.name)))
  for (const p of [...enumerate({ bias })]) {
    if (p.clauses[0].body.length === 0) continue
    const hv = headVars(p), bv = bodyVars(p)
    expect([...bv].some(v => hv.has(v))).toBe(true) // body touches a head variable
  }
})

test("mode-directed enumeration drops clauses that read an unbound input", () => {
  // f/2 is moded f(In, Out). With head t(In), only V0 is bound, so f(V0, V1) is well-moded
  // but f(V1, V0) reads the unbound V1 in its input position and must be pruned.
  const moded = {
    head_predicates: [{ name: "t", arity: 1, mode: ["in"] }],
    body_predicates: [{ name: "f", arity: 2, mode: ["in", "out"] }],
    max_clauses: 1, max_body_length: 1, max_variables: 2, allow_recursion: false
  }
  const firstArgs = bias => [...enumerate({ bias })]
    .filter(p => p.clauses[0].body.length === 1)
    .map(p => p.clauses[0].body[0].args[0].name)
  // Every surviving body atom takes the bound V0 in its input position.
  expect(firstArgs(moded).every(n => n === "V0")).toBe(true)
  // Strip the modes and the unbound-input form reappears (it is still connected).
  const relational = { ...moded, head_predicates: [{ name: "t", arity: 1 }], body_predicates: [{ name: "f", arity: 2 }] }
  expect(firstArgs(relational).some(n => n === "V1")).toBe(true)
})

test("a constants pool adds constant-bearing clauses, ordered after constant-free ones (#043)", () => {
  // head t/2 with max_variables == arity, so body-length-1 is a single variable-count bucket
  // and the constant-free-before-constant-bearing order holds across the whole length-1 run.
  const base = {
    head_predicates: [{ name: "t", arity: 2 }],
    body_predicates: [{ name: "e", arity: 2 }],
    max_clauses: 1, max_body_length: 1, max_variables: 2, allow_recursion: false
  }
  const withConst = { ...base, constants: [{ value: 9 }] }
  const hasConstClause = p => p.clauses[0].body.some(a => a.args.some(x => x.type === "const"))

  const without = [...enumerate({ bias: base })]
  const withC = [...enumerate({ bias: withConst })]

  // Backward-compatible: dropping the constant-bearing clauses reproduces the no-pool stream.
  expect(withC.filter(p => !hasConstClause(p))).toEqual(without)

  // The pool adds at least one constant-bearing clause, and within body-length 1 every
  // constant-free clause precedes every constant-bearing one.
  const len1 = withC.filter(p => p.clauses[0].body.length === 1)
  const split = len1.findIndex(hasConstClause)
  expect(split).toBeGreaterThan(0)
  expect(len1.slice(0, split).every(p => !hasConstClause(p))).toBe(true)
  expect(len1.slice(split).every(hasConstClause)).toBe(true)
})

test("a typed constant is only placed in positions of its type (#043/#045)", () => {
  // Head t(colour, coord); body e typed [colour, coord]. The constant is a colour, so it may
  // fill e's position 0 (colour) but never position 1 (coord) — e(7, V1) is valid (V1 is the
  // head's coord variable), e(.., 7) never appears.
  const bias = {
    head_predicates: [{ name: "t", arity: 2, arg_types: ["colour", "coord"] }],
    body_predicates: [{ name: "e", arity: 2, arg_types: ["colour", "coord"] }],
    constants: [{ value: 7, type: "colour" }],
    max_clauses: 1, max_body_length: 1, max_variables: 2, allow_recursion: false
  }
  const constPositions = [...enumerate({ bias })]
    .flatMap(p => p.clauses[0].body)
    .flatMap(a => a.args.map((x, i) => ({ x, i })))
    .filter(({ x }) => x.type === "const")
    .map(({ i }) => i)
  expect(constPositions.length).toBeGreaterThan(0)
  expect(constPositions.every(i => i === 0)).toBe(true) // colour constant never lands in the coord slot
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
