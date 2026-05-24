import { test, expect } from "bun:test"
import { termLayout } from "../src/engine/buffer.js"
import { packTerms, packTermInto, batchByteLength, makeSymbols } from "../src/engine/pack.js"
import { unpackTerms, unpackTermFrom } from "../src/engine/unpack.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

const layout = termLayout(4, 5)

function roundTrip(term, l = layout) {
  const { packed, symbols } = packTerms([term], l)
  return unpackTerms(packed, 1, l, symbols)[0]
}

test("round-trips constants of every value type", () => {
  expect(roundTrip(C("a"))).toEqual(C("a"))
  expect(roundTrip(C(42))).toEqual(C(42))
  expect(roundTrip(C(true))).toEqual(C(true))
})

test("round-trips a variable, with the canonical V{id} name", () => {
  expect(roundTrip(V("V0", 0))).toEqual(V("V0", 0))
  // names aren't packed — an arbitrary name comes back canonicalized, id preserved
  expect(roundTrip(V("X", 3))).toEqual(V("V3", 3))
})

test("round-trips a nested compound", () => {
  const list = f("cons", C(1), f("cons", C(2), C("nil")))
  expect(roundTrip(list)).toEqual(list)
})

test("round-trips a mixed term with variables and compounds", () => {
  const term = f("p", V("V0", 0), f("g", C("a"), V("V1", 1)))
  expect(roundTrip(term)).toEqual(term)
})

test("round-trips a zero-arity compound", () => {
  expect(roundTrip(f("nil"))).toEqual(f("nil"))
})

test("shared symbols are interned once", () => {
  const { symbols } = packTerms([C("a"), C("a"), f("a", C("b"))], layout)
  // "a" (used as const value and as a functor) interns once; "b" once → 2 symbols
  expect(symbols.size()).toBe(2)
})

test("a batch round-trips through one buffer", () => {
  const terms = [C("x"), V("V0", 0), f("pair", V("V0", 0), C(7))]
  const { packed, symbols } = packTerms(terms, layout)
  expect(packed.byteLength).toBe(batchByteLength(layout, 3))
  expect(unpackTerms(packed, 3, layout, symbols)).toEqual(terms)
})

test("the batch is a single allocation, not one per term", () => {
  let allocCalls = 0
  const countingAlloc = (byteLength, l) => {
    allocCalls++
    return { buffer: null, view: new Int32Array(byteLength / 4), layout: l, byteLength, offset: 0 }
  }
  packTerms([C(1), C(2), C(3), C(4), C(5)], layout, { alloc: countingAlloc })
  expect(allocCalls).toBe(1)
})

test("a term deeper than the slot budget is rejected", () => {
  // a left-nested chain longer than slotsPerTerm
  const tiny = termLayout(2, 2) // slotsPerTerm = 4
  let term = C("end")
  for (let i = 0; i < 10; i++) term = f("s", term)
  expect(() => packTerms([term], tiny)).toThrow(/slot budget/)
})

test("packing does not depend on zero-initialized memory (recycled-buffer safety)", () => {
  // Simulate a recycled pool buffer: pre-fill with garbage. packTermInto must clear
  // its region, or stale child_offsets get read as real children.
  const view = new Int32Array(layout.intsPerTerm).fill(999)
  const symbols = makeSymbols()
  packTermInto(view, 0, layout, symbols, f("p", C("a"))) // p/1: leaves trailing slots/offsets
  expect(unpackTermFrom(view, 0, layout, symbols)).toEqual(f("p", C("a")))
})

test("a functor exceeding maxArity is rejected", () => {
  const tiny = termLayout(2, 5) // maxArity = 2
  expect(() => packTerms([f("wide", C(1), C(2), C(3))], tiny)).toThrow(/exceeds maxArity/)
})
