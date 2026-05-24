// Backend selection. On this (non-Metal) platform gpuAvailable() is false and "auto"
// resolves to the CPU path, which must still produce correct masks. On Apple Silicon
// "auto" would resolve to "gpu"; that path is covered by tests/ops-gpu.test.js.

import { test, expect } from "bun:test"
import { gpuAvailable, resolveBackend } from "../src/engine/ops/backend.js"
import { unifyBatch } from "../src/engine/ops/unify_batch.js"
import { termLayout } from "../src/engine/buffer.js"

const C = value => ({ type: "const", value })

test("gpuAvailable is false without Metal and caches its result", async () => {
  const a = await gpuAvailable()
  const b = await gpuAvailable()
  expect(a).toBe(false)
  expect(b).toBe(false)
})

test("resolveBackend passes explicit choices through and resolves auto", async () => {
  expect(await resolveBackend("cpu")).toBe("cpu")
  expect(await resolveBackend("gpu")).toBe("gpu")
  expect(await resolveBackend("auto")).toBe("cpu") // no GPU here
  expect(await resolveBackend(undefined)).toBe("cpu")
})

test("unifyBatch with backend 'auto' runs and is correct (falls back to CPU)", async () => {
  const layout = termLayout(4, 5)
  const mask = await unifyBatch([C("a"), C("b")], [C("a"), C("b")], layout, { backend: "auto" })
  expect(Array.from(mask)).toEqual([1, 0, 0, 1])
})
