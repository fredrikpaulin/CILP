// GPU parity test. Needs a working Metal GPU — run `bash build.sh` first (it compiles the
// three shaders into copper.metallib). For a shared set of inputs, the GPU backend of each
// op must produce exactly the mask the CPU reference does. The gate is real GPU
// availability, not the platform: a Mac without the dylib built must skip, not crash. The
// ops modules are imported lazily so the suite never starts Metal where it's skipped.

import { test, expect } from "bun:test"
import { gpuAvailable } from "../src/engine/ops/backend.js"

// gpuAvailable() probes by importing the device module inside a try and caches the result,
// so this top-level await resolves to false (never throws) wherever Metal is absent.
const gpuTest = (await gpuAvailable()) ? test : test.skip

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const f = (functor, ...args) => ({ type: "compound", functor, args })

gpuTest("unify_batch: GPU matches the CPU reference", async () => {
  const { termLayout } = await import("../src/engine/buffer.js")
  const { unifyBatch } = await import("../src/engine/ops/unify_batch.js")
  const layout = termLayout(4, 5)

  const candidates = [C("a"), V("V0", 0), f("p", V("V0", 0), C("b")), f("p", V("V0", 0), V("V0", 0))]
  const examples = [C("a"), C("b"), f("p", C("a"), C("b")), f("p", C("a"), C("a")), f("q", C("a"))]

  const cpu = await unifyBatch(candidates, examples, layout, { backend: "cpu" })
  const gpu = await unifyBatch(candidates, examples, layout, { backend: "gpu" })
  expect(Array.from(gpu)).toEqual(Array.from(cpu))
})

gpuTest("coverage: GPU matches the CPU reference", async () => {
  const { termLayout } = await import("../src/engine/buffer.js")
  const { coverageVector } = await import("../src/engine/ops/coverage.js")
  const layout = termLayout(4, 5)

  const candidate = f("p", V("V0", 0))
  const examples = [f("p", C("a")), f("q", C("a")), f("p", C("b")), C("a")]

  const cpu = await coverageVector(candidate, examples, layout, { backend: "cpu" })
  const gpu = await coverageVector(candidate, examples, layout, { backend: "gpu" })
  expect(Array.from(gpu)).toEqual(Array.from(cpu))
})

gpuTest("constraint_mask: GPU matches the CPU reference", async () => {
  const { termLayout } = await import("../src/engine/buffer.js")
  const { constraintMask } = await import("../src/engine/ops/mask.js")
  const layout = termLayout(4, 5)

  const forbidden = f("p", V("V0", 0), C("b"))
  const candidates = [f("p", V("V0", 0), C("b")), f("p", V("V0", 0), C("c")), f("q", V("V0", 0), C("b")), C("b")]

  const cpu = await constraintMask(candidates, forbidden, layout, { backend: "cpu" })
  const gpu = await constraintMask(candidates, forbidden, layout, { backend: "gpu" })
  expect(Array.from(gpu)).toEqual(Array.from(cpu))
})
