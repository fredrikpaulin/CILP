import { test, expect } from "bun:test"
import { unify, walk, applySubstitution } from "../src/core/unify.js"

const v = (name, id) => ({ type: "var", name, id })
const c = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

test("identical constants unify", () => {
  expect(unify(c("a"), c("a"))).not.toBeNull()
})

test("different constants do not unify", () => {
  expect(unify(c("a"), c("b"))).toBeNull()
  expect(unify(c(1), c("1"))).toBeNull() // value equality is strict
})

test("a variable binds to a constant", () => {
  const sub = unify(v("X", 0), c("a"))
  expect(sub).not.toBeNull()
  expect(walk(v("X", 0), sub)).toEqual(c("a"))
})

test("binding works in either argument order", () => {
  const sub = unify(c("a"), v("X", 0))
  expect(walk(v("X", 0), sub)).toEqual(c("a"))
})

test("two variables unify and follow the chain", () => {
  let sub = unify(v("X", 0), v("Y", 1))
  sub = unify(v("Y", 1), c("a"), sub)
  expect(sub).not.toBeNull()
  expect(walk(v("X", 0), sub)).toEqual(c("a"))
})

test("the same variable unifies with itself", () => {
  expect(unify(v("X", 0), v("X", 0))).not.toBeNull()
})

test("compounds unify recursively", () => {
  const sub = unify(f("p", v("X", 0), c("b")), f("p", c("a"), v("Y", 1)))
  expect(sub).not.toBeNull()
  expect(walk(v("X", 0), sub)).toEqual(c("a"))
  expect(walk(v("Y", 1), sub)).toEqual(c("b"))
})

test("compounds with different functors or arities fail", () => {
  expect(unify(f("p", c("a")), f("q", c("a")))).toBeNull()
  expect(unify(f("p", c("a")), f("p", c("a"), c("b")))).toBeNull()
})

test("constant and compound do not unify", () => {
  expect(unify(c("a"), f("a"))).toBeNull()
})

test("occurs-check rejects infinite terms", () => {
  // X = f(X) has no finite solution
  expect(unify(v("X", 0), f("f", v("X", 0)))).toBeNull()
  // and indirectly: X = f(Y), Y = X
  let sub = unify(v("X", 0), f("f", v("Y", 1)))
  expect(unify(v("Y", 1), v("X", 0), sub)).toBeNull()
})

test("unify does not mutate the input substitution", () => {
  const sub = new Map()
  const result = unify(v("X", 0), c("a"), sub)
  expect(sub.size).toBe(0) // original untouched
  expect(result.size).toBe(1)
})

test("applySubstitution resolves nested terms", () => {
  const sub = unify(f("p", v("X", 0), v("Y", 1)), f("p", c("a"), f("g", c("b"))))
  const resolved = applySubstitution(f("p", v("X", 0), v("Y", 1)), sub)
  expect(resolved).toEqual(f("p", c("a"), f("g", c("b"))))
})
