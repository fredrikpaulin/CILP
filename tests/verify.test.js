import { test, expect } from "bun:test"
import { verify, firstProof } from "../src/core/index.js"
import { makeRegistry } from "../src/core/background.js"
import { predicates as family } from "./fixtures/family.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

// grandparent(X, Z) :- parent(X, Y), parent(Y, Z).
// firstProof, like interpret, expects a normalized program: variables carry ids.
const grandparent = {
  clauses: [{
    head: atom("grandparent", V("X", 0), V("Z", 1)),
    body: [atom("parent", V("X", 0), V("Y", 2)), atom("parent", V("Y", 2), V("Z", 1))]
  }]
}
const reg = makeRegistry(family)

// A ground atom's place in a proof trace: predicate plus constant args.
const groundAtom = (predicate, ...values) => ({
  predicate,
  args: values.map(C)
})

test("a covered positive carries a proof of witnessing facts", () => {
  const { covered, trace } = firstProof(grandparent, reg, atom("grandparent", C("tom"), C("ann")))
  expect(covered).toBe(true)
  // The background facts that fired: parent(tom, bob) and parent(bob, ann).
  const facts = trace.filter(e => e.via === "background").map(e => e.goal)
  expect(facts).toContainEqual(groundAtom("parent", "tom", "bob"))
  expect(facts).toContainEqual(groundAtom("parent", "bob", "ann"))
  // The head expansion is recorded too, fully ground.
  const heads = trace.filter(e => e.via === "clause").map(e => e.goal)
  expect(heads).toContainEqual(groundAtom("grandparent", "tom", "ann"))
})

test("an atom that does not hold has no proof", () => {
  // tom's grandchildren are ann and pat; jim is a great-grandchild.
  const { covered, trace } = firstProof(grandparent, reg, atom("grandparent", C("tom"), C("jim")))
  expect(covered).toBe(false)
  expect(trace).toBeNull()
})

test("verify reports per-example coverage with proof traces", () => {
  const result = verify(grandparent, reg, {
    positives: [atom("grandparent", C("tom"), C("ann")), atom("grandparent", C("tom"), C("pat"))],
    negatives: [atom("grandparent", C("tom"), C("jim")), atom("grandparent", C("bob"), C("bob"))]
  })

  expect(result.correct).toBe(true)
  expect(result.positives.every(p => p.covered)).toBe(true)
  expect(result.negatives.every(n => !n.covered)).toBe(true)

  // Each positive carries its example and a proof; each negative carries no proof.
  for (const p of result.positives) {
    expect(p.example).toBeDefined()
    expect(Array.isArray(p.proof)).toBe(true)
    expect(p.proof.length).toBeGreaterThan(0)
  }
  for (const n of result.negatives) {
    expect(n.proof).toBeNull()
  }
})

test("correct is false when a negative is covered", () => {
  const result = verify(grandparent, reg, {
    positives: [atom("grandparent", C("tom"), C("ann"))],
    negatives: [atom("grandparent", C("tom"), C("pat"))] // actually holds
  })
  expect(result.correct).toBe(false)
  expect(result.negatives[0].covered).toBe(true)
})

test("correct is false when a positive is not covered", () => {
  const result = verify(grandparent, reg, {
    positives: [atom("grandparent", C("tom"), C("jim"))], // does not hold
    negatives: []
  })
  expect(result.correct).toBe(false)
  expect(result.positives[0].covered).toBe(false)
  expect(result.positives[0].proof).toBeNull()
})

test("missing example lists default to empty and verify is vacuously correct", () => {
  const result = verify(grandparent, reg, {})
  expect(result.positives).toEqual([])
  expect(result.negatives).toEqual([])
  expect(result.correct).toBe(true)
})

test("the proof trace is checkable: re-running each atom reproduces it", () => {
  const goal = atom("grandparent", C("tom"), C("ann"))
  const { trace } = firstProof(grandparent, reg, goal)
  // Every background atom in the trace is itself entailed by the background alone.
  for (const e of trace.filter(e => e.via === "background")) {
    const again = firstProof({ clauses: [] }, reg, e.goal)
    expect(again.covered).toBe(true)
  }
})
