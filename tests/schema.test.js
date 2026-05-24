import { test, expect } from "bun:test"
import { validate, isTerm, isAtom, isClause, isProgram } from "../src/core/schema.js"

const v = (name, id) => (id === undefined ? { type: "var", name } : { type: "var", name, id })
const c = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

test("accepts well-formed terms", () => {
  expect(isTerm(v("X"))).toBe(true)
  expect(isTerm(v("X", 0))).toBe(true)
  expect(isTerm(c("a"))).toBe(true)
  expect(isTerm(c(42))).toBe(true)
  expect(isTerm(c(true))).toBe(true)
  expect(isTerm(f("s", c(0)))).toBe(true)
  expect(isTerm(f("cons", c(1), f("cons", c(2), c("nil"))))).toBe(true)
})

test("rejects malformed terms", () => {
  expect(isTerm({ type: "var" })).toBe(false) // missing name
  expect(isTerm({ type: "var", name: "" })).toBe(false) // empty name
  expect(isTerm({ type: "const" })).toBe(false) // missing value
  expect(isTerm({ type: "const", value: { nested: 1 } })).toBe(false) // object value
  expect(isTerm({ type: "compound", functor: "f" })).toBe(false) // missing args
  expect(isTerm({ type: "foo", value: 1 })).toBe(false) // unknown tag
  expect(isTerm({ type: "var", name: "X", extra: 1 })).toBe(false) // additional property
})

test("variable id must be an integer when present", () => {
  expect(isTerm({ type: "var", name: "X", id: 1.5 })).toBe(false)
  expect(isTerm({ type: "var", name: "X", id: 2 })).toBe(true)
})

test("validates atoms, clauses, and programs", () => {
  const head = { predicate: "target", args: [v("X", 0), v("Y", 1)] }
  const body = [{ predicate: "succ", args: [v("X", 0), v("Y", 1)] }]
  expect(isAtom(head)).toBe(true)
  expect(isClause({ head, body })).toBe(true)
  expect(isClause({ head, body: [] })).toBe(true) // a fact
  expect(isProgram({ clauses: [{ head, body }] })).toBe(true)
})

test("rejects malformed atoms and clauses", () => {
  expect(isAtom({ predicate: "p" })).toBe(false) // missing args
  expect(isAtom({ predicate: "", args: [] })).toBe(false) // empty predicate
  expect(isClause({ head: { predicate: "p", args: [] } })).toBe(false) // missing body
  expect(isProgram({ clauses: [{ head: {}, body: [] }] })).toBe(false) // bad head
})

test("reports useful errors", () => {
  const r = validate({ type: "var" }, "term")
  expect(r.valid).toBe(false)
  expect(r.errors.length).toBeGreaterThan(0)
})

test("terms round-trip through JSON", () => {
  const samples = [
    v("X", 0),
    c("hello"),
    f("cons", c(1), f("cons", c(2), c("nil"))),
    { head: { predicate: "p", args: [v("X", 0)] }, body: [{ predicate: "q", args: [v("X", 0)] }] }
  ]
  for (const s of samples) {
    const round = JSON.parse(JSON.stringify(s))
    expect(round).toEqual(s)
  }
})
