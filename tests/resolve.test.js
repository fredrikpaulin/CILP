import { test, expect } from "bun:test"
import { interpret } from "../src/core/resolve.js"
import { makeRegistry } from "../src/core/background.js"
import { walk } from "../src/core/unify.js"
import { predicates as family } from "./fixtures/family.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

const facts = {
  clauses: [
    { head: atom("p", C("a")), body: [] },
    { head: atom("p", C("b")), body: [] }
  ]
}
const empty = makeRegistry()

test("a fact query succeeds and fails correctly", () => {
  expect([...interpret(facts, empty, atom("p", C("a")))].length).toBe(1)
  expect([...interpret(facts, empty, atom("p", C("c")))].length).toBe(0)
})

test("a variable query enumerates all solutions", () => {
  const sols = [...interpret(facts, empty, atom("p", V("X", 0)))]
  expect(sols.map(s => walk(V("X", 0), s).value).sort()).toEqual(["a", "b"])
})

test("a rule resolves against background predicates", () => {
  // grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
  const program = {
    clauses: [{
      head: atom("grandparent", V("X", 0), V("Z", 1)),
      body: [atom("parent", V("X", 0), V("Y", 2)), atom("parent", V("Y", 2), V("Z", 1))]
    }]
  }
  const reg = makeRegistry(family)
  const sols = [...interpret(program, reg, atom("grandparent", C("tom"), V("Z", 9)))]
  expect(sols.map(s => walk(V("Z", 9), s).value).sort()).toEqual(["ann", "pat"])
})

test("recursion is explored and bounded by maxDepth", () => {
  // ancestor(X, Y) :- parent(X, Y).
  // ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
  const ancestor = {
    clauses: [
      { head: atom("ancestor", V("X", 0), V("Y", 1)),
        body: [atom("parent", V("X", 0), V("Y", 1))] },
      { head: atom("ancestor", V("X", 0), V("Y", 1)),
        body: [atom("parent", V("X", 0), V("Z", 2)), atom("ancestor", V("Z", 2), V("Y", 1))] }
    ]
  }
  const reg = makeRegistry(family)
  const run = d =>
    [...interpret(ancestor, reg, atom("ancestor", C("tom"), V("Y", 9)), { maxDepth: d })]
      .map(s => walk(V("Y", 9), s).value).sort()
  expect(run(1)).toEqual(["bob"])
  expect(run(2)).toEqual(["ann", "bob", "pat"])
  expect(run(3)).toEqual(["ann", "bob", "jim", "pat"])
})

test("a long non-recursive chain of program goals is not cut by the recursion bound", () => {
  // p(X) :- a(X), b(X), c(X).  a/b/c each defer to a background fact. No predicate
  // recurses, so even maxDepth 1 should let the whole conjunction through — the bound
  // measures recursion depth, not total clause expansions.
  const program = {
    clauses: [
      { head: atom("p", V("X", 0)), body: [atom("a", V("X", 0)), atom("b", V("X", 0)), atom("c", V("X", 0))] },
      { head: atom("a", V("X", 0)), body: [atom("fact", V("X", 0))] },
      { head: atom("b", V("X", 0)), body: [atom("fact", V("X", 0))] },
      { head: atom("c", V("X", 0)), body: [atom("fact", V("X", 0))] }
    ]
  }
  const reg = makeRegistry({ fact: () => true })
  // Three program predicates nest only one deep each; maxDepth 1 is enough.
  expect([...interpret(program, reg, atom("p", C("z")), { maxDepth: 1 })].length).toBe(1)
})

test("the recursion bound counts re-entries per predicate, not siblings", () => {
  // ping(X) :- pong(X).  pong(X) :- ping(X).  mutual recursion, base via stop.
  // ping(X) :- stop(X).   With maxDepth 1, ping may be active once: ping -> pong -> ping
  // would be a second ping activation and is cut, so only the direct stop succeeds.
  const program = {
    clauses: [
      { head: atom("ping", V("X", 0)), body: [atom("stop", V("X", 0))] },
      { head: atom("ping", V("X", 0)), body: [atom("pong", V("X", 0))] },
      { head: atom("pong", V("X", 0)), body: [atom("ping", V("X", 0))] }
    ]
  }
  const reg = makeRegistry({ stop: () => true })
  // maxDepth 1: ping active at most once -> one solution (the base case), no infinite loop.
  expect([...interpret(program, reg, atom("ping", C("z")), { maxDepth: 1 })].length).toBe(1)
  // maxDepth 2: ping may re-enter once via pong, reaching stop again -> two solutions.
  expect([...interpret(program, reg, atom("ping", C("z")), { maxDepth: 2 })].length).toBe(2)
})
