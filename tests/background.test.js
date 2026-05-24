import { test, expect } from "bun:test"
import { makeRegistry, loadBackground } from "../src/core/background.js"
import { unify, walk, applySubstitution } from "../src/core/unify.js"
import { predicates as family } from "./fixtures/family.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })

test("a boolean test predicate yields the substitution unchanged or nothing", () => {
  const reg = makeRegistry({
    positive: (args, sub) => {
      const a = applySubstitution(args[0], sub)
      return a.type === "const" && typeof a.value === "number" && a.value > 0
    }
  })
  expect([...reg.solve("positive", [C(5)], new Map())].length).toBe(1)
  expect([...reg.solve("positive", [C(-2)], new Map())].length).toBe(0)
})

test("a deterministic predicate can return a substitution binding an output", () => {
  const reg = makeRegistry({
    succ: (args, sub) => {
      const a = walk(args[0], sub)
      if (a.type === "const" && typeof a.value === "number") {
        return unify(args[1], C(a.value + 1), sub)
      }
      return false
    }
  })
  const sols = [...reg.solve("succ", [C(3), V("Y", 0)], new Map())]
  expect(sols.length).toBe(1)
  expect(walk(V("Y", 0), sols[0])).toEqual(C(4))
})

test("a generator predicate yields multiple solutions", () => {
  const reg = makeRegistry(family)
  const sols = [...reg.solve("parent", [C("bob"), V("C", 0)], new Map())]
  expect(sols.map(s => walk(V("C", 0), s).value).sort()).toEqual(["ann", "pat"])
})

test("has() reports registration and unknown predicates throw", () => {
  const reg = makeRegistry(family)
  expect(reg.has("parent")).toBe(true)
  expect(reg.has("nope")).toBe(false)
  expect(() => [...reg.solve("nope", [], new Map())]).toThrow(/no background predicate/)
})

test("loadBackground loads { predicates } from a module path", async () => {
  const url = new URL("./fixtures/family.js", import.meta.url).href
  const reg = await loadBackground(url)
  expect(reg.has("parent")).toBe(true)
})
