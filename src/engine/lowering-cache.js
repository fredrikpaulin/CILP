// A memoizing wrapper around `lower`. Lowered source is a pure function of the program,
// the lowering options (target, modes, import specifiers), the harness's semantics, and
// the lowering code itself — so identical inputs always produce identical output, and the
// server can skip re-lowering a program it has already lowered (Appendix A §A.9, #033).
//
// The cache key includes everything that affects the output: a canonical form of the
// program and options, the harness's semantic hash (its primitive modes feed the
// lowering), and LOWERING_VERSION (so a changed lowering never serves stale source). The
// store is unbounded — fine for a single-process server; eviction is a later concern.

import { lower as defaultLower, LOWERING_VERSION } from "../core/lowering/index.js"

// Recursively sort object keys so equal inputs serialize identically; arrays keep order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k])
    return out
  }
  return value
}

function cacheKey(program, harness, options) {
  return JSON.stringify([
    LOWERING_VERSION,
    harness?.semantic_hash ?? null,
    canonical(options),
    canonical(program)
  ])
}

export function makeLoweringCache(lowerFn = defaultLower) {
  const store = new Map()
  const stats = { hits: 0, misses: 0 }
  function lower(program, harness, options = {}) {
    const key = cacheKey(program, harness, options)
    if (store.has(key)) { stats.hits++; return store.get(key) }
    stats.misses++
    const result = lowerFn(program, harness, options)
    store.set(key, result)
    return result
  }
  return { lower, stats, get size() { return store.size } }
}
