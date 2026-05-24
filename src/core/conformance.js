// Conformance: does an implementation actually behave the way its manifest declares?
// The manifest's example calls double as a test suite (#023) — every implementation of
// a manifest must agree on them. This runs each declared call against an implementation
// and checks the solutions match the declared result.
//
// `semanticHash` (harness.js) and conformance are complementary: the hash checks that an
// implementation targets the manifest you mean (identity); conformance checks that it
// gets the primitives right (behaviour). An implementation can pass one and fail the
// other — a stale build with the wrong hash, or a current build with a buggy predicate.

import { makeRegistry } from "./background.js"
import { normalize } from "./normalize.js"
import { applySubstitution } from "./unify.js"

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k])
    return out
  }
  return value
}
const key = obj => JSON.stringify(canonical(obj))

// Run one example call, returning its solutions as variable bindings (name -> term).
// The call is normalized first so its variables carry ids — solving an un-normalized
// multi-variable call collapses the variables, since substitutions key by id.
function solutionsOf(registry, call) {
  const { value, names } = normalize(call)
  const vars = [...names.entries()].map(([id, name]) => ({ type: "var", name, id }))
  const out = []
  for (const sub of registry.solve(value.predicate, value.args, new Map())) {
    const binding = {}
    for (const v of vars) binding[v.name] = applySubstitution(v, sub)
    out.push(binding)
  }
  return out
}

// Compare a solution set to the declared result:
//   true / undefined     -> the call must hold (>= 1 solution)
//   false                -> the call must not hold (0 solutions)
//   { solutions: [...] }  -> the exact set of variable bindings, order-independent
function matches(solutions, result) {
  if (result === undefined || result === true) return solutions.length > 0
  if (result === false) return solutions.length === 0
  if (result && Array.isArray(result.solutions)) {
    const actual = solutions.map(key).sort()
    const expected = result.solutions.map(key).sort()
    return actual.length === expected.length && actual.every((s, i) => s === expected[i])
  }
  return false
}

// Check an implementation against a manifest's declared example calls. Returns
// { conforms, results, untested }: per-example pass/fail (with an error string if a
// call threw), and the primitives that declare no examples — not failures, just not
// exercised, surfaced so a thin manifest doesn't masquerade as a tested one.
export function conform(manifest, implementation) {
  const registry = makeRegistry(implementation.predicates ?? {})
  const results = []
  const untested = []
  for (const prim of manifest.primitives ?? []) {
    const examples = prim.examples ?? []
    if (examples.length === 0) { untested.push(prim.name); continue }
    for (const ex of examples) {
      let conforms = false, error = null
      try {
        conforms = matches(solutionsOf(registry, ex.call), ex.result)
      } catch (e) {
        error = e.message
      }
      results.push({ primitive: prim.name, call: ex.call, conforms, ...(error ? { error } : {}) })
    }
  }
  return { conforms: results.every(r => r.conforms), results, untested }
}
