import { test, expect } from "bun:test"
import {
  TAG, SLOT_FIELD,
  slotLayout, termLayout, clauseLayout, coverageMaskLayout,
  validateLayout, cpuPackedBuffer
} from "../src/engine/buffer.js"

test("slot layout sizes match the architecture (maxArity 4 → 24-byte slot)", () => {
  const s = slotLayout(4)
  expect(s.intsPerSlot).toBe(6)   // type_tag + functor_id + 4 child offsets
  expect(s.bytesPerSlot).toBe(24)
  expect(SLOT_FIELD).toEqual({ typeTag: 0, functorId: 1, childOffsets: 2 })
  expect(TAG).toEqual({ EMPTY: 0, VAR: 1, CONST: 2, COMPOUND: 3 })
})

test("term layout caps slots at maxDepth × maxArity", () => {
  const t = termLayout(4, 5)
  expect(t.slotsPerTerm).toBe(20)        // 5 × 4 — the architecture's terms_per_eval ≈ 20
  expect(t.intsPerSlot).toBe(6)
  expect(t.intsPerTerm).toBe(120)        // 6 × 20
})

test("clause layout reserves one slot per (variable) argument", () => {
  const c = clauseLayout(4, 3)
  expect(c.atomsPerClause).toBe(4)       // head + 3 body
  expect(c.intsPerAtom).toBe(1 + 4 * 6)  // predicate id + maxArity slots
  expect(c.intsPerClause).toBe(4 * (1 + 4 * 6))
})

test("coverage mask is one byte per candidate/example pair", () => {
  const m = coverageMaskLayout(1000, 50)
  expect(m.byteLength).toBe(50000)
  expect(m.bytesPerEntry).toBe(1)
})

test("layout descriptors validate against their schemas", () => {
  expect(validateLayout(termLayout(4, 5)).valid).toBe(true)
  expect(validateLayout(clauseLayout(4, 3)).valid).toBe(true)
  expect(validateLayout(coverageMaskLayout(10, 10)).valid).toBe(true)
  // a malformed descriptor is rejected
  expect(validateLayout({ kind: "packed-term", maxArity: 4 }).valid).toBe(false)
  expect(validateLayout({ kind: "nope" }).valid).toBe(false)
})

test("a CPU-backed PackedBuffer is a typed view over a plain buffer", () => {
  const layout = termLayout(4, 5)
  const pb = cpuPackedBuffer(layout.intsPerTerm * 4, layout)
  expect(pb.buffer).toBe(null)
  expect(pb.offset).toBe(0)
  expect(pb.layout.$id).toBe("copper:layout/packed-term")
  expect(pb.byteLength).toBe(120 * 4)
  expect(pb.view).toBeInstanceOf(Int32Array)
  expect(pb.view.length).toBe(120)
  // round-trip raw ints through the view (the precursor to term packing in #013)
  pb.view[0] = TAG.COMPOUND
  pb.view[1] = 42
  expect(pb.view[0]).toBe(TAG.COMPOUND)
  expect(pb.view[1]).toBe(42)
})
