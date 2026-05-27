import { test, expect, afterAll } from "bun:test"
import { lower, lowerJavaScript, interpret, walk, makeRegistry, normalize } from "../src/core/index.js"
import { predicates as listsP } from "../libraries/lists/1.0.0/javascript.js"
import { predicates as familyP } from "./fixtures/family.js"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { rmSync } from "node:fs"

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const nil = { type: "compound", functor: "nil", args: [] }
const cons = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })
const clause = (head, ...body) => ({ head, body })
const atom = (predicate, ...args) => ({ predicate, args })

// Generated modules are written here, imported, and run. The interpreter cannot import
// a string, so behavioural equivalence is checked against real executed code.
const tmp = resolve(import.meta.dir, ".lowering-tmp")
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

async function runLowered(program, harness, options, entrypoint, ...inArgs) {
  const { source } = lowerJavaScript(program, harness, options)
  const path = `${tmp}/cl_${Math.random().toString(36).slice(2)}.js`
  await Bun.write(path, source)
  const mod = await import(pathToFileURL(path).href)
  return [...mod[entrypoint](...inArgs)] // each yield is an array of out-arg terms
}

// The interpreter's solutions for a single-output query, as the bound output values.
function interpreted(program, predicates, query, outVar) {
  const reg = makeRegistry(predicates)
  return [...interpret(normalize(program).value, reg, query)].map(s => walk(outVar, s).value)
}

const listsManifest = await Bun.file(resolve(import.meta.dir, "../libraries/lists/1.0.0/manifest.json")).json()
const listsImpl = resolve(import.meta.dir, "../libraries/lists/1.0.0/javascript.js")
const familyImpl = resolve(import.meta.dir, "fixtures/family.js")
const familyHarness = { primitives: [{ name: "parent", arity: 2, modes: ["in", "out"], description: "parent", determinism: "nondet" }] }

test("a det chain lowers and matches the interpreter", async () => {
  // second(L, X) :- tail(L, T), head(T, X).
  const second = { clauses: [clause(atom("second", V("L"), V("X")), atom("tail", V("L"), V("T")), atom("head", V("T"), V("X")))] }
  const list = cons(C(10), cons(C(20), cons(C(30), nil)))
  const lowered = (await runLowered(second, listsManifest,
    { modes: { second: ["in", "out"] }, implementation: listsImpl }, "lowered_second", list)).map(t => t[0].value)
  const interp = interpreted(second, listsP, atom("second", list, V("X")), V("X"))
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual([20])
})

test("a nondet primitive lowers to a loop and matches the interpreter", async () => {
  // grandparent(X, Z) :- parent(X, Y), parent(Y, Z).  parent is nondet.
  const gp = { clauses: [clause(atom("grandparent", V("X"), V("Z")), atom("parent", V("X"), V("Y")), atom("parent", V("Y"), V("Z")))] }
  const lowered = (await runLowered(gp, familyHarness,
    { modes: { grandparent: ["in", "out"] }, implementation: familyImpl }, "lowered_grandparent", C("tom"))).map(t => t[0].value).sort()
  const interp = interpreted(gp, familyP, atom("grandparent", C("tom"), V("Z")), V("Z")).sort()
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual(["ann", "pat"])
})

test("recursion lowers as native recursion, reported as a caveat, and matches", async () => {
  // ancestor(X, Y) :- parent(X, Y).
  // ancestor(X, Y) :- parent(X, Z), ancestor(Z, Y).
  const ancestor = {
    clauses: [
      clause(atom("ancestor", V("X"), V("Y")), atom("parent", V("X"), V("Y"))),
      clause(atom("ancestor", V("X"), V("Y")), atom("parent", V("X"), V("Z")), atom("ancestor", V("Z"), V("Y")))
    ]
  }
  const opts = { modes: { ancestor: ["in", "out"] }, implementation: familyImpl }
  const meta = lowerJavaScript(ancestor, familyHarness, opts).metadata
  expect(meta.feasibility).toBe("caveats")
  expect(meta.caveats[0]).toMatch(/recursive/)

  const lowered = (await runLowered(ancestor, familyHarness, opts, "lowered_ancestor", C("tom"))).map(t => t[0].value).sort()
  const interp = interpreted(ancestor, familyP, atom("ancestor", C("tom"), V("Y")), V("Y")).sort()
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual(["ann", "bob", "jim", "pat"])
})

test("an already-bound out-arg on a synthesized call is an equality constraint, not a rebind", async () => {
  // common(Y) :- ancestor(tom, Y), ancestor(bob, Y).  The second ancestor call's Y is
  // already bound by the first, so its out position is a constraint to match, not a slot
  // to rebind. The bug rebound it and produced the cartesian product (12 rows) instead of
  // the intersection of tom's and bob's descendants (3 rows).
  const prog = {
    clauses: [
      clause(atom("ancestor", V("X"), V("Y")), atom("parent", V("X"), V("Y"))),
      clause(atom("ancestor", V("X"), V("Y")), atom("parent", V("X"), V("Z")), atom("ancestor", V("Z"), V("Y"))),
      clause(atom("common", V("Y")), atom("ancestor", C("tom"), V("Y")), atom("ancestor", C("bob"), V("Y")))
    ]
  }
  const opts = { modes: { ancestor: ["in", "out"], common: ["out"] }, implementation: familyImpl }
  const lowered = (await runLowered(prog, familyHarness, opts, "lowered_common")).map(t => t[0].value).sort()
  const interp = interpreted(prog, familyP, atom("common", V("Y")), V("Y")).sort()
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual(["ann", "jim", "pat"])
})

test("a body constant lowers to a term literal and matches the interpreter", async () => {
  // childOfTom(Y) :- parent(tom, Y).  The constant tom sits in an input position; the
  // lowering renders it as a term literal passed to the relational solve. (#043 downstream)
  const prog = { clauses: [clause(atom("childOfTom", V("Y")), atom("parent", C("tom"), V("Y")))] }
  const opts = { modes: { childOfTom: ["out"] }, implementation: familyImpl }
  const lowered = (await runLowered(prog, familyHarness, opts, "lowered_childOfTom")).map(t => t[0].value).sort()
  const interp = interpreted(prog, familyP, atom("childOfTom", V("Y")), V("Y")).sort()
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual(["bob"])
})

test("an unmoded predicate is reported as non-lowerable", () => {
  const prog = { clauses: [clause(atom("p", V("X"), V("Y")), atom("mystery", V("X"), V("Y")))] }
  const { source, metadata } = lower(prog, { primitives: [] }, { modes: { p: ["in", "out"] } })
  expect(source).toBeNull()
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/no mode declaration/)
})

test("an ill-moded clause (output read before it is produced) is non-lowerable", () => {
  // bad(X, Y) :- parent(Y, X).  Y is a head output, so it is unbound when parent reads it.
  const prog = { clauses: [clause(atom("bad", V("X"), V("Y")), atom("parent", V("Y"), V("X")))] }
  const { metadata } = lower(prog, familyHarness, { modes: { bad: ["in", "out"] } })
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/unbound variable Y/)
})

test("a compound argument is reported as outside the lowerable subset", () => {
  const prog = { clauses: [clause(atom("p", V("X")), atom("head", cons(C(1), nil), V("X")))] }
  const { metadata } = lower(prog, listsManifest, { modes: { p: ["out"] } })
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/compound arguments/)
})

test("metadata reports target, imports, and entrypoints", () => {
  const gp = { clauses: [clause(atom("grandparent", V("X"), V("Z")), atom("parent", V("X"), V("Y")), atom("parent", V("Y"), V("Z")))] }
  const { metadata } = lower(gp, familyHarness, { modes: { grandparent: ["in", "out"] }, implementation: "./javascript.js" })
  expect(metadata.target).toBe("javascript")
  expect(metadata.imports).toEqual(["copper-ilp/core", "./javascript.js"])
  expect(metadata.entrypoints).toEqual(["lowered_grandparent"])
})
