// Tests the batch ops on the CPU backend — the reference the Metal kernels must match.
// Structural unification here is occurs-check-free and depth-bounded, exactly like the
// kernels (and unlike core/unify.js).

import { test, expect } from "bun:test"
import { termLayout } from "../src/engine/buffer.js"
import { unifyBatch } from "../src/engine/ops/unify_batch.js"
import { coverageVector } from "../src/engine/ops/coverage.js"
import { constraintMask } from "../src/engine/ops/mask.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

const layout = termLayout(4, 5)

test("unify_batch: constants match only themselves", async () => {
  const mask = await unifyBatch([C("a"), C("b")], [C("a"), C("b"), C("c")], layout)
  // 2 candidates × 3 examples, row-major
  expect(Array.from(mask)).toEqual([
    1, 0, 0, // a vs a,b,c
    0, 1, 0  // b vs a,b,c
  ])
})

test("unify_batch: a variable unifies with anything", async () => {
  const mask = await unifyBatch([V("V0", 0)], [C("a"), f("g", C("b")), V("V0", 0)], layout)
  expect(Array.from(mask)).toEqual([1, 1, 1])
})

test("unify_batch: compounds unify structurally", async () => {
  const candidates = [f("p", V("V0", 0), C("b"))]
  const examples = [
    f("p", C("a"), C("b")), // unifies: V0 = a
    f("p", C("a"), C("z")), // fails: b vs z
    f("q", C("a"), C("b")), // fails: functor
    f("p", C("a"))          // fails: arity
  ]
  const mask = await unifyBatch(candidates, examples, layout)
  expect(Array.from(mask)).toEqual([1, 0, 0, 0])
})

test("unify_batch: a variable used twice must bind consistently", async () => {
  // p(V0, V0) unifies with p(a, a) but not p(a, b)
  const candidates = [f("p", V("V0", 0), V("V0", 0))]
  const examples = [f("p", C("a"), C("a")), f("p", C("a"), C("b"))]
  const mask = await unifyBatch(candidates, examples, layout)
  expect(Array.from(mask)).toEqual([1, 0])
})

test("coverage: one candidate against many examples", async () => {
  const mask = await coverageVector(f("p", V("V0", 0)), [f("p", C("a")), f("q", C("a")), f("p", C("b"))], layout)
  expect(Array.from(mask)).toEqual([1, 0, 1])
})

test("constraint_mask: marks candidates identical to the forbidden region", async () => {
  const forbidden = f("p", V("V0", 0), C("b"))
  const candidates = [
    f("p", V("V0", 0), C("b")), // identical → pruned
    f("p", V("V0", 0), C("c")), // different constant
    f("q", V("V0", 0), C("b"))  // different functor
  ]
  const mask = await constraintMask(candidates, forbidden, layout)
  expect(Array.from(mask)).toEqual([1, 0, 0])
})
