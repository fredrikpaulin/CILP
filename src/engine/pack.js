// Packs JSON terms into the flat slot layout (see buffer.js). A term becomes a tree
// of slots inside a fixed-size region: the root at slot 0, children allocated from a
// cursor at slots ≥ 1, with each compound's child_offsets pointing at them. A
// child_offset of 0 means "no argument" (slot 0 is always the root, never a child).
//
// Symbols — functor names and constant values — are interned into a shared table so
// the buffer holds only integers; the GPU compares those integers, and unpack maps
// them back. Variable names are not packed: only the integer id is, since the
// executor matches on ids. unpack restores a canonical name "V{id}".

import { TAG, cpuPackedBuffer } from "./buffer.js"

// Intern table shared across everything packed in one batch, so the same symbol gets
// the same id in candidate and example terms — which is what makes them comparable.
export function makeSymbols() {
  const toId = new Map()
  const fromId = []
  return {
    intern(value) {
      if (toId.has(value)) return toId.get(value)
      const id = fromId.length
      toId.set(value, id)
      fromId.push(value)
      return id
    },
    value(id) { return fromId[id] },
    size() { return fromId.length }
  }
}

// Pack one term into `view` starting at int offset `base`. Returns the slot count used.
export function packTermInto(view, base, layout, symbols, term) {
  const { intsPerSlot, maxArity, slotsPerTerm } = layout

  // Zero the whole region first. Unused slots must read as EMPTY and unwritten
  // child_offsets as 0 ("no child"); a fresh ArrayBuffer is zeroed, but a recycled
  // pool buffer is not — so packing must never assume zero-initialized memory.
  const intsPerTerm = intsPerSlot * slotsPerTerm
  for (let i = 0; i < intsPerTerm; i++) view[base + i] = 0

  let cursor = 1 // slot 0 is the root; children take slots from 1 upward

  function pack(slotIndex, t) {
    const o = base + slotIndex * intsPerSlot
    if (t.type === "var") {
      if (typeof t.id !== "number") throw new Error("packTerm requires normalized variables (missing id)")
      view[o] = TAG.VAR
      view[o + 1] = t.id
    } else if (t.type === "const") {
      view[o] = TAG.CONST
      view[o + 1] = symbols.intern(t.value)
    } else if (t.type === "compound") {
      view[o] = TAG.COMPOUND
      view[o + 1] = symbols.intern(t.functor)
      for (let i = 0; i < t.args.length; i++) {
        if (i >= maxArity) throw new Error(`functor ${t.functor}/${t.args.length} exceeds maxArity ${maxArity}`)
        if (cursor >= slotsPerTerm) throw new Error(`term exceeds the ${slotsPerTerm}-slot budget`)
        const childSlot = cursor++
        view[o + 2 + i] = childSlot
        pack(childSlot, t.args[i])
      }
    } else {
      throw new Error(`cannot pack term of type "${t.type}"`)
    }
  }

  pack(0, term)
  return cursor
}

// Bytes needed to pack `count` term regions (one term per (candidate, example) pair
// in a B × E batch, so count = B × E).
export function batchByteLength(layout, count) {
  return count * layout.intsPerTerm * 4
}

// Pack an array of terms into one buffer — a single allocation for the whole batch,
// returned as a unit (no per-term retain/release). `alloc` is injected: the CPU
// allocator by default, the Metal pool on Apple Silicon. Symbols are shared across
// the batch.
export function packTerms(terms, layout, options = {}) {
  const alloc = options.alloc ?? cpuPackedBuffer
  const symbols = options.symbols ?? makeSymbols()
  const packed = alloc(batchByteLength(layout, terms.length), layout, Int32Array)
  for (let i = 0; i < terms.length; i++) {
    packTermInto(packed.view, i * layout.intsPerTerm, layout, symbols, terms[i])
  }
  return { packed, symbols }
}
