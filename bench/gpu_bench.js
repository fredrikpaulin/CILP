// Measures batched structural unification on the GPU against the CPU reference — the
// C2 headline ("unification-as-SIMD-on-fixed-shape-terms"). Run on Apple Silicon after
// `bash build.sh`:  bun bench/gpu_bench.js [candidates] [examples]
//
// The GPU result is checked against the CPU result before any timing is reported, so a
// speedup is only printed for a verified-identical computation. On a non-Metal platform
// it reports CPU-only timing and notes the GPU is unavailable.

import { termLayout } from "../src/engine/buffer.js"
import { unifyBatch } from "../src/engine/ops/unify_batch.js"
import { gpuAvailable } from "../src/engine/ops/backend.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

const B = Number(process.argv[2] ?? 2000)
const E = Number(process.argv[3] ?? 200)
const layout = termLayout(4, 5)

// Candidate: p(V0, g(a, V1)). Example j: p(c_j, g(a|z, d)) — even j fails at the inner
// constant (z ≠ a), odd j unifies. Real unification work, a known answer per column.
const candidates = Array.from({ length: B }, () =>
  f("p", V("V0", 0), f("g", C("a"), V("V1", 1)))
)
const examples = Array.from({ length: E }, (_, j) =>
  f("p", C("c" + (j % 16)), f("g", j % 2 ? C("a") : C("z"), C("d")))
)

function ms(fn) {
  const t = performance.now()
  return fn().then(r => ({ r, ms: performance.now() - t }))
}

const pairs = B * E
console.log(`workload: ${B} candidates × ${E} examples = ${pairs.toLocaleString()} pairs`)
console.log(`layout: ${layout.intsPerTerm} ints/term, ${(layout.intsPerTerm * 4)} bytes/term`)

const cpu = await ms(() => unifyBatch(candidates, examples, layout, { backend: "cpu" }))
console.log(`cpu:  ${cpu.ms.toFixed(1)} ms  (${(pairs / cpu.ms).toFixed(0)} pairs/ms)`)

if (!(await gpuAvailable())) {
  console.log("gpu:  unavailable on this platform (no Metal / dylib not built)")
  process.exit(0)
}

const gpu = await ms(() => unifyBatch(candidates, examples, layout, { backend: "gpu" }))

// Identical-results check before reporting a speedup.
let identical = cpu.r.length === gpu.r.length
for (let i = 0; identical && i < cpu.r.length; i++) if (cpu.r[i] !== gpu.r[i]) identical = false
console.log(`parity: ${identical ? "GPU matches CPU bit for bit" : "MISMATCH — speedup not meaningful"}`)

console.log(`gpu:  ${gpu.ms.toFixed(1)} ms  (${(pairs / gpu.ms).toFixed(0)} pairs/ms)`)
console.log(`speedup (wall clock, incl. pack + dispatch + readback): ${(cpu.ms / gpu.ms).toFixed(1)}x`)

// Per-kernel GPU time, to show where the wall-clock goes.
const profile = await import("../src/engine/gpu/profile.js")
profile.enableProfiling()
profile.resetProfile()
await unifyBatch(candidates, examples, layout, { backend: "gpu" })
const rep = profile.report()
profile.disableProfiling()
console.log(`kernel-only gpu time: ${rep.totalGpuMs} ms across ${rep.dispatches} dispatch(es)`)
console.log(`peak device memory delta: ${(rep.memory.deltaBytes / 1e6).toFixed(1)} MB`)
