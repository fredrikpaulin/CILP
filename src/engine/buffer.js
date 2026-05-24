// The packing layer's foundation: the slot layout, the layout descriptors for the
// three buffer kinds (packed terms, packed clauses, coverage masks), and the
// PackedBuffer abstraction. This file is pure JavaScript with no Metal import, so the
// layout logic and the round-trip in #013 can be developed and tested without a GPU.
// A CPU-backed PackedBuffer (plain ArrayBuffer) and a Metal-backed one (the pool, see
// gpu/poolbuffer.js) are interchangeable, because both are just typed views over bytes.

import { validate } from "../core/schema.js"

// A term node is packed into a fixed-size slot of i32s:
//   [ type_tag, functor_id, child_offset_0 .. child_offset_{maxArity-1} ]
// type_tag says what the slot is; functor_id indexes a string table (or holds a
// constant value); child_offsets point to child slots (for compounds).
export const TAG = { EMPTY: 0, VAR: 1, CONST: 2, COMPOUND: 3 }
export const SLOT_FIELD = { typeTag: 0, functorId: 1, childOffsets: 2 }

export function slotLayout(maxArity) {
  const intsPerSlot = 2 + maxArity
  return { maxArity, intsPerSlot, bytesPerSlot: intsPerSlot * 4, field: SLOT_FIELD }
}

// A packed term reserves up to maxDepth × maxArity slots — the architecture's
// fixed cap, which covers the small terms ILP actually produces. Deeper terms are
// rejected at pack time (#013).
export function termLayout(maxArity, maxDepth) {
  const intsPerSlot = 2 + maxArity
  const slotsPerTerm = maxDepth * maxArity
  return {
    $id: "copper:layout/packed-term",
    kind: "packed-term",
    maxArity,
    maxDepth,
    intsPerSlot,
    slotsPerTerm,
    intsPerTerm: intsPerSlot * slotsPerTerm
  }
}

// A packed clause is the head atom plus up to maxBodyLength body atoms. Each atom is
// a predicate id followed by maxArity argument slots — one slot per argument, since
// hypothesis-clause arguments are variables (general terms appear in examples and use
// the term layout above).
export function clauseLayout(maxArity, maxBodyLength) {
  const intsPerSlot = 2 + maxArity
  const atomsPerClause = 1 + maxBodyLength
  const intsPerAtom = 1 + maxArity * intsPerSlot
  return {
    $id: "copper:layout/packed-clause",
    kind: "packed-clause",
    maxArity,
    maxBodyLength,
    atomsPerClause,
    intsPerSlot,
    intsPerAtom,
    intsPerClause: atomsPerClause * intsPerAtom
  }
}

// A coverage mask is one byte per (candidate, example) pair.
export function coverageMaskLayout(candidates, examples) {
  return {
    $id: "copper:layout/coverage-mask",
    kind: "coverage-mask",
    candidates,
    examples,
    bytesPerEntry: 1,
    byteLength: candidates * examples
  }
}

const KIND_SCHEMA = {
  "packed-term": "packedTermLayout",
  "packed-clause": "packedClauseLayout",
  "coverage-mask": "coverageMaskLayout"
}

export function validateLayout(descriptor) {
  const schemaKind = KIND_SCHEMA[descriptor?.kind]
  if (!schemaKind) return { valid: false, errors: [`unknown layout kind "${descriptor?.kind}"`] }
  return validate(descriptor, schemaKind)
}

// A PackedBuffer is a typed view over a flat buffer, plus the layout descriptor that
// gives the bytes meaning. `buffer` is the backing MTLBuffer pointer when pool-backed,
// or null when CPU-backed. `layout` is the descriptor (its $id is the layout URI).
export function makePackedBuffer({ buffer = null, view, layout, byteLength, offset = 0 }) {
  return { buffer, view, layout, byteLength, offset }
}

// CPU-backed PackedBuffer over a plain ArrayBuffer. Same layout semantics as a Metal
// shared buffer; the difference is only where the bytes live.
export function cpuPackedBuffer(byteLength, layout, ViewType = Int32Array) {
  const view = new ViewType(new ArrayBuffer(byteLength))
  return makePackedBuffer({ buffer: null, view, layout, byteLength, offset: 0 })
}
