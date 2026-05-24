import { test, expect } from "bun:test"
import { normalize, denormalize } from "../src/core/normalize.js"

const V = (name, id) => (id === undefined ? { type: "var", name } : { type: "var", name, id })
const atom = (predicate, ...args) => ({ predicate, args })

test("assigns ids by first appearance within a clause", () => {
  const clause = { head: atom("p", V("X"), V("Y")), body: [atom("q", V("Y"), V("Z"))] }
  const { value, names } = normalize(clause)
  expect(value.head.args[0]).toEqual(V("X", 0))
  expect(value.head.args[1]).toEqual(V("Y", 1))
  expect(value.body[0].args[0]).toEqual(V("Y", 1)) // same name, same id
  expect(value.body[0].args[1]).toEqual(V("Z", 2))
  expect(names.get(0)).toBe("X")
  expect(names.get(1)).toBe("Y")
})

test("each clause is its own scope", () => {
  const program = { clauses: [
    { head: atom("p", V("A")), body: [] },
    { head: atom("q", V("B")), body: [] }
  ] }
  const { value } = normalize(program)
  expect(value.clauses[0].head.args[0].id).toBe(0)
  expect(value.clauses[1].head.args[0].id).toBe(0) // independent scope, reuses 0
})

test("denormalize strips ids; round-trip is identity on authored input", () => {
  const program = { clauses: [{
    head: atom("anc", V("X"), V("Y")),
    body: [atom("parent", V("X"), V("Z")), atom("anc", V("Z"), V("Y"))]
  }] }
  expect(denormalize(normalize(program).value)).toEqual(program)
})

test("normalization is stable", () => {
  const clause = { head: atom("p", V("X"), V("Y")), body: [atom("q", V("X"))] }
  expect(normalize(clause).value).toEqual(normalize(clause).value)
})

test("normalizes a bare atom in its own scope", () => {
  const { value } = normalize(atom("p", V("X"), V("X"), V("Y")))
  expect(value.args[0]).toEqual(V("X", 0))
  expect(value.args[1]).toEqual(V("X", 0)) // same name → same id
  expect(value.args[2]).toEqual(V("Y", 1))
})
