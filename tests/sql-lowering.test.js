import { test, expect } from "bun:test"
import { lowerSql, interpret, walk, makeRegistry, normalize } from "../src/core/index.js"
import { predicates as family } from "./fixtures/family.js"
import { Database } from "bun:sqlite"

const V = name => ({ type: "var", name })
const Vi = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const clause = (head, ...body) => ({ head, body })
const atom = (predicate, ...args) => ({ predicate, args })

// A SQLite db with the `parent` base relation (columns c0, c1) populated from the family.
function parentDb() {
  const db = new Database(":memory:")
  db.run("CREATE TABLE parent (c0 TEXT, c1 TEXT)")
  db.run("INSERT INTO parent VALUES (?,?),(?,?),(?,?),(?,?)", ["tom", "bob", "bob", "ann", "bob", "pat", "pat", "jim"])
  return db
}

// The full relation, as sorted "a,b" rows, both from SQL and from the interpreter.
function sqlRows(source, view) {
  const db = parentDb()
  db.exec(source)
  return db.query(`SELECT c0, c1 FROM ${view}`).all().map(r => `${r.c0},${r.c1}`).sort()
}
function interpretedRows(program, pred) {
  const reg = makeRegistry(family)
  // Distinct ids on the two query variables so they don't collide on lookup.
  const q = atom(pred, Vi("A", 100), Vi("B", 101))
  return [...interpret(normalize(program).value, reg, q, { maxDepth: 20 })]
    .map(s => `${walk(Vi("A", 100), s).value},${walk(Vi("B", 101), s).value}`).sort()
}

// grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
const grandparent = { clauses: [clause(atom("grandparent", V("X"), V("Z")), atom("parent", V("X"), V("Y")), atom("parent", V("Y"), V("Z")))] }
// ancestor(X, Y) :- parent(X, Y).  ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
const ancestor = {
  clauses: [
    clause(atom("ancestor", V("X"), V("Y")), atom("parent", V("X"), V("Y"))),
    clause(atom("ancestor", V("X"), V("Y")), atom("parent", V("X"), V("Z")), atom("ancestor", V("Z"), V("Y")))
  ]
}

test("a non-recursive join lowers to SQL that matches the interpreter", () => {
  const { source, metadata } = lowerSql(grandparent, null, {})
  expect(metadata.feasibility).toBe("ok")
  expect(metadata.entrypoints).toEqual(["grandparent"])
  expect(source).toContain("CREATE VIEW grandparent")
  expect(sqlRows(source, "grandparent")).toEqual(interpretedRows(grandparent, "grandparent"))
})

test("linear recursion lowers to a recursive CTE that matches the interpreter's fixpoint", () => {
  const { source, metadata } = lowerSql(ancestor, null, {})
  expect(metadata.feasibility).toBe("ok")
  expect(source).toContain("WITH RECURSIVE")
  // SQL computes the full transitive closure; a high maxDepth reaches the same fixpoint.
  expect(sqlRows(source, "ancestor")).toEqual(interpretedRows(ancestor, "ancestor"))
})

test("a constant in a body goal becomes a filter and still matches", () => {
  // childOfBob(C) :- parent(b, C).  (a constant in an input position)
  const prog = { clauses: [clause(atom("childOfBob", V("C")), atom("parent", C("bob"), V("C")))] }
  const db = parentDb()
  db.exec(lowerSql(prog, null, {}).source)
  const rows = db.query("SELECT c0 FROM childOfBob").all().map(r => r.c0).sort()
  expect(rows).toEqual(["ann", "pat"])
})

test("compound arguments are reported as not expressible in SQL", () => {
  const prog = { clauses: [clause(atom("p", V("X")), atom("head", { type: "compound", functor: "cons", args: [C(1), { type: "compound", functor: "nil", args: [] }] }, V("X")))] }
  const { source, metadata } = lowerSql(prog, null, {})
  expect(source).toBeNull()
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/compound arguments/)
})

test("an unsafe rule (head variable not bound by the body) is infeasible", () => {
  // q(X, Y) :- parent(X, _Z).  Y appears only in the head — SQL can't produce it.
  const prog = { clauses: [clause(atom("q", V("X"), V("Y")), atom("parent", V("X"), V("Z")))] }
  const { metadata } = lowerSql(prog, null, {})
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/unsafe rule.*Y/)
})

test("non-linear recursion is reported infeasible", () => {
  // r(X, Y) :- r(X, Z), r(Z, Y).  two recursive calls in one clause.
  const prog = {
    clauses: [
      clause(atom("r", V("X"), V("Y")), atom("parent", V("X"), V("Y"))),
      clause(atom("r", V("X"), V("Y")), atom("r", V("X"), V("Z")), atom("r", V("Z"), V("Y")))
    ]
  }
  const { metadata } = lowerSql(prog, null, {})
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/non-linear recursion/)
})

test("mutual recursion is reported infeasible", () => {
  // even/odd mutual recursion has no plain recursive-CTE form here.
  const prog = {
    clauses: [
      clause(atom("even", V("X"), V("Y")), atom("parent", V("X"), V("Y"))),
      clause(atom("even", V("X"), V("Y")), atom("parent", V("X"), V("Z")), atom("odd", V("Z"), V("Y"))),
      clause(atom("odd", V("X"), V("Y")), atom("parent", V("X"), V("Z")), atom("even", V("Z"), V("Y")))
    ]
  }
  const { metadata } = lowerSql(prog, null, {})
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/mutual recursion/)
})
