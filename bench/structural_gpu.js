// Structural-coverage benchmark (#035). Structural coverage — does a fact pattern unify
// with each example — is the one coverage regime the GPU computes directly. This times the
// `coverageVector` op (the operation a structural synthesize search performs per candidate)
// over a large example batch, CPU backend vs auto (GPU when Metal is present).
//
// On a machine without Metal, "auto" resolves to CPU and the ratio is ~1; on Apple Silicon
// it shows the batched-unification speedup. Run: bun bench/structural_gpu.js

import { termLayout } from "../src/engine/buffer.js"
import { coverageVector } from "../src/engine/ops/coverage.js"
import { resolveBackend } from "../src/engine/ops/backend.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

const layout = termLayout(2, 4)
// Candidate: edge(a, V1). Examples: edge(a, k) for many k (covered) and edge(b, k) (not).
const candidate = f("edge", C("a"), V("V1", 1))
const N = Number(process.argv[2] ?? 200000)
const examples = Array.from({ length: N }, (_, i) => f("edge", C(i % 3 === 0 ? "b" : "a"), C(`n${i}`)))

async function timed(backend, iters) {
  await coverageVector(candidate, examples.slice(0, 1024), layout, { backend }) // warm
  const t0 = Bun.nanoseconds()
  for (let i = 0; i < iters; i++) await coverageVector(candidate, examples, layout, { backend })
  return (Bun.nanoseconds() - t0) / 1e6 / iters
}

console.log(`structural coverage over ${N} examples — per-call time, lower is better`)
// What "auto" actually resolves to decides how the second row reads. When it's GPU the
// ratio is a real CPU-vs-GPU speedup; when it's CPU (no Metal) the second timing runs the
// same backend as the baseline, so any ratio is measurement noise, not a speedup — label it
// from the resolved backend, never from "auto happened to be faster".
const autoBackend = await resolveBackend("auto")
const cpu = await timed("cpu", 5)
let auto
try { auto = await timed("auto", 5) } catch (e) { auto = null }
console.log(`  cpu  ${cpu.toFixed(2)} ms`)
if (auto === null) console.log("  auto: unavailable (no GPU backend)")
else if (autoBackend === "gpu") console.log(`  auto ${auto.toFixed(2)} ms   ${(cpu / auto).toFixed(1)}x (GPU)`)
else console.log(`  auto ${auto.toFixed(2)} ms   (CPU — no GPU present; same backend as baseline, ratio is noise)`)
