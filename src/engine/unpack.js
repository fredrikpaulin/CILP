// Reverses pack.js: reads a flat slot region back into a JSON term. The slot's
// type_tag says what to build; child_offsets (the non-zero ones) point at argument
// slots. Variable names aren't stored, so a variable is restored with the canonical
// name "V{id}" — the executor and callers work in ids, and symbolic names are
// recovered, when needed, through the normalization map, not through unpacking.

import { TAG } from "./buffer.js"

// Unpack one term from `view` starting at int offset `base`.
export function unpackTermFrom(view, base, layout, symbols) {
  const { intsPerSlot, maxArity } = layout

  function read(slotIndex) {
    const o = base + slotIndex * intsPerSlot
    const tag = view[o]
    if (tag === TAG.VAR) {
      const id = view[o + 1]
      return { type: "var", name: "V" + id, id }
    }
    if (tag === TAG.CONST) {
      return { type: "const", value: symbols.value(view[o + 1]) }
    }
    if (tag === TAG.COMPOUND) {
      const functor = symbols.value(view[o + 1])
      const args = []
      for (let i = 0; i < maxArity; i++) {
        const childSlot = view[o + 2 + i]
        if (childSlot !== 0) args.push(read(childSlot))
      }
      return { type: "compound", functor, args }
    }
    throw new Error(`cannot unpack slot tag ${tag} at slot ${slotIndex}`)
  }

  return read(0)
}

// Unpack `count` term regions from a packed batch buffer.
export function unpackTerms(packed, count, layout, symbols) {
  const out = []
  for (let i = 0; i < count; i++) {
    out.push(unpackTermFrom(packed.view, i * layout.intsPerTerm, layout, symbols))
  }
  return out
}
