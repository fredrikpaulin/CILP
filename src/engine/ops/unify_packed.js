// CPU reference for structural unification over packed terms — the exact algorithm
// the unify_batch Metal kernel implements, and the oracle its output is checked
// against. Iterative with an explicit stack (no native recursion, so it transliterates
// to MSL), per-side variable bindings, and no occurs-check: the depth/slot bounds the
// packing already enforces keep it total, and the GPU can't afford occurs-check either.
// This is the fast structural filter, distinct from core/unify.js (which is precise
// and does occurs-check). Both sides must be packed against the same symbol table, so
// that equal functors and constants share an integer id.

import { TAG } from "../buffer.js"

// A ref locates a slot: { view, base, slot, side }. `side` ("A"/"B") keys the binding
// namespace, since a candidate and an example are independent variable scopes.
export function unifyPacked(refA, refB, layout) {
  const bind = { A: new Map(), B: new Map() }
  const intsPerSlot = layout.intsPerSlot
  const off = r => r.base + r.slot * intsPerSlot
  const tag = r => r.view[off(r)]
  const fid = r => r.view[off(r) + 1]
  const childAt = (r, k) => r.view[off(r) + 2 + k]

  const resolve = r => {
    while (tag(r) === TAG.VAR && bind[r.side].has(fid(r))) r = bind[r.side].get(fid(r))
    return r
  }

  const stack = [[refA, refB]]
  while (stack.length) {
    const [p, q] = stack.pop()
    const a = resolve(p)
    const b = resolve(q)
    const ta = tag(a)
    const tb = tag(b)

    if (ta === TAG.VAR && tb === TAG.VAR && a.side === b.side && fid(a) === fid(b)) continue // same var
    if (ta === TAG.VAR) { bind[a.side].set(fid(a), b); continue }
    if (tb === TAG.VAR) { bind[b.side].set(fid(b), a); continue }

    if (ta === TAG.CONST && tb === TAG.CONST) {
      if (fid(a) !== fid(b)) return false
      continue
    }
    if (ta === TAG.COMPOUND && tb === TAG.COMPOUND) {
      if (fid(a) !== fid(b)) return false
      for (let k = 0; k < layout.maxArity; k++) {
        const ca = childAt(a, k)
        const cb = childAt(b, k)
        if (ca === 0 && cb === 0) continue
        if (ca === 0 || cb === 0) return false // arity mismatch
        stack.push([{ ...a, slot: ca }, { ...b, slot: cb }])
      }
      continue
    }
    return false // const vs compound, or empty
  }
  return true
}
