// Substitution microbenchmark (#020). The persistent trie-backed unify versus the
// copying-Map baseline it replaced, on wide and deep terms where the per-bind copy is
// O(n²). Run: bun bench/sub_bench.js
//
// This is a measurement harness, not a test — it prints per-unify times and the speedup.

import { unify as persistentUnify } from "../src/core/unify.js"

// The pre-#020 implementation, inlined so the comparison is honest and self-contained.
function walkM(term, sub) {
  while (term.type === "var" && sub.has(term.id)) term = sub.get(term.id)
  return term
}
function occursM(id, term, sub) {
  term = walkM(term, sub)
  if (term.type === "var") return term.id === id
  if (term.type === "compound") return term.args.some(a => occursM(id, a, sub))
  return false
}
function bindM(v, term, sub) {
  if (occursM(v.id, term, sub)) return null
  const next = new Map(sub)
  next.set(v.id, term)
  return next
}
function copyingUnify(a, b, sub = new Map()) {
  a = walkM(a, sub)
  b = walkM(b, sub)
  if (a.type === "var" && b.type === "var" && a.id === b.id) return sub
  if (a.type === "var") return bindM(a, b, sub)
  if (b.type === "var") return bindM(b, a, sub)
  if (a.type === "const" && b.type === "const") return a.value === b.value ? sub : null
  if (a.type === "compound" && b.type === "compound") {
    if (a.functor !== b.functor || a.args.length !== b.args.length) return null
    for (let i = 0; i < a.args.length; i++) {
      sub = copyingUnify(a.args[i], b.args[i], sub)
      if (sub === null) return null
    }
    return sub
  }
  return null
}

const V = id => ({ type: "var", name: `V${id}`, id })
const C = value => ({ type: "const", value })

// f(V0, …, Vn-1) against f(c0, …, cn-1): n binds in one unify.
function wide(n) {
  return [
    { type: "compound", functor: "f", args: Array.from({ length: n }, (_, i) => V(i)) },
    { type: "compound", functor: "f", args: Array.from({ length: n }, (_, i) => C(i)) }
  ]
}

// f(V0, f(V1, … nil)) against the fully ground spine: n nested binds.
function deep(n) {
  let vt = C("nil"), ct = C("nil")
  for (let i = n - 1; i >= 0; i--) {
    vt = { type: "compound", functor: "f", args: [V(i), vt] }
    ct = { type: "compound", functor: "f", args: [C(i), ct] }
  }
  return [vt, ct]
}

function perUnifyMs(fn, a, b, iters) {
  for (let i = 0; i < 3; i++) fn(a, b) // warmup
  const t0 = Bun.nanoseconds()
  for (let i = 0; i < iters; i++) fn(a, b)
  return (Bun.nanoseconds() - t0) / 1e6 / iters
}

function row(label, pair, iters) {
  const cp = perUnifyMs(copyingUnify, pair[0], pair[1], iters)
  const ps = perUnifyMs(persistentUnify, pair[0], pair[1], iters)
  console.log(`${label}  copying ${cp.toFixed(3)} ms   persistent ${ps.toFixed(3)} ms   ${(cp / ps).toFixed(1)}x`)
}

console.log("substitution microbenchmark (#020) — per-unify time, lower is better")
row("wide  n=500 ", wide(500), 200)
row("wide  n=2000", wide(2000), 40)
row("deep  n=500 ", deep(500), 200)
row("deep  n=2000", deep(2000), 40)
