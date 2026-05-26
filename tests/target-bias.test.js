import { test, expect } from "bun:test"
import { synthesize } from "../src/engine/synthesize.js"
import { lowerSql, lowerJavaScript } from "../src/core/index.js"
import { predicates as family } from "./fixtures/family.js"

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })
const clause = (head, ...body) => ({ head, body })

// gp(X, Z) :- parent(X, Y).            Z is never bound by the body — an unsafe rule. It
// still *covers* the positives (the example grounds Z), but it lowers to neither SQL
// (range restriction) nor JavaScript (Z is never produced).
const unsafe = { clauses: [clause(atom("gp", V("X"), V("Z")), atom("parent", V("X"), V("Y")))] }
// gp(X, Z) :- parent(X, Y), parent(Y, Z).   the real grandparent rule — lowers cleanly.
const safe = { clauses: [clause(atom("gp", V("X"), V("Z")), atom("parent", V("X"), V("Y")), atom("parent", V("Y"), V("Z")))] }

const problem = {
  bias: {
    head_predicates: [{ name: "gp", arity: 2, mode: ["in", "out"] }],
    body_predicates: [{ name: "parent", arity: 2, mode: ["in", "out"] }],
    max_clauses: 1, max_body_length: 2, max_variables: 3, max_recursion_depth: 1, allow_recursion: false
  },
  background: family,
  positives: [atom("gp", C("tom"), C("ann")), atom("gp", C("tom"), C("pat"))],
  negatives: []
}

// Both programs cover the positives, so the enumeration order decides what's returned.
const bothInOrder = function* () { yield unsafe; yield safe }

test("the unsafe rule covers but lowers to neither SQL nor JavaScript", () => {
  expect(lowerSql(unsafe, null, {}).metadata.feasibility).toBe("infeasible")
  expect(lowerJavaScript(unsafe, null, { modes: { gp: ["in", "out"], parent: ["in", "out"] } }).metadata.feasibility).toBe("infeasible")
})

test("target-unaware synthesis returns the first covering program, even if it won't lower", async () => {
  const sol = await synthesize(problem, { enumerate: bothInOrder })
  expect(sol.stats.found).toBe(true)
  expect(sol.program).toEqual(unsafe) // first acceptable in enumeration order
  expect(sol.stats.candidates_target_skipped).toBe(0)
})

test("target-biased synthesis (sql) skips the infeasible covering program and returns one that lowers", async () => {
  const sol = await synthesize(problem, { enumerate: bothInOrder, target: "sql" })
  expect(sol.stats.found).toBe(true)
  expect(sol.program).toEqual(safe)
  expect(sol.stats.candidates_target_skipped).toBe(1)
  expect(lowerSql(sol.program, null, {}).metadata.feasibility).toBe("ok")
})

test("target-biased synthesis (javascript) also skips the unproducible-output rule", async () => {
  const sol = await synthesize(problem, { enumerate: bothInOrder, target: "javascript" })
  expect(sol.stats.found).toBe(true)
  expect(sol.program).toEqual(safe)
  expect(sol.stats.candidates_target_skipped).toBe(1)
})

test("if only target-infeasible covering programs exist, biased synthesis reports not-found", async () => {
  // The cost of the bias: it will not pass off a program that won't lower as a solution.
  const sol = await synthesize(problem, { enumerate: function* () { yield unsafe }, target: "sql" })
  expect(sol.stats.found).toBe(false)
  expect(sol.stats.candidates_target_skipped).toBe(1)
})
