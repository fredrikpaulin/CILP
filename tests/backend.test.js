// Backend selection is platform-dependent: gpuAvailable() is true on Apple Silicon with
// the dylib built, false otherwise, and is cached. resolveBackend passes explicit choices
// through and resolves "auto" to whatever the platform offers. Either backend produces
// identical masks — the GPU path is checked bit-for-bit in tests/ops-gpu.test.js — so these
// assertions hold on both Metal and non-Metal machines.

import { test, expect } from "bun:test"
import { gpuAvailable, resolveBackend } from "../src/engine/ops/backend.js"
import { unifyBatch } from "../src/engine/ops/unify_batch.js"
import { termLayout } from "../src/engine/buffer.js"

const C = value => ({ type: "const", value })

test("gpuAvailable returns a stable, cached boolean", async () => {
  const a = await gpuAvailable()
  const b = await gpuAvailable()
  expect(typeof a).toBe("boolean")
  expect(b).toBe(a) // cached: same answer every call
})

test("resolveBackend passes explicit choices through and resolves auto to the platform", async () => {
  expect(await resolveBackend("cpu")).toBe("cpu")
  expect(await resolveBackend("gpu")).toBe("gpu")
  const expected = (await gpuAvailable()) ? "gpu" : "cpu"
  expect(await resolveBackend("auto")).toBe(expected)
  expect(await resolveBackend(undefined)).toBe("cpu") // the default never probes Metal
})

test("unifyBatch with backend 'auto' runs and is correct on whichever backend it picks", async () => {
  const layout = termLayout(4, 5)
  const mask = await unifyBatch([C("a"), C("b")], [C("a"), C("b")], layout, { backend: "auto" })
  expect(Array.from(mask)).toEqual([1, 0, 0, 1])
})
