// LLM-assisted bias (C3). The model is mocked here — a function returning a bias JSON —
// so the prompt/parse/validate contract and the hybrid loop are tested without an LLM.

import { test, expect } from "bun:test"
import { buildBiasPrompt, parseBiasResponse, validateBias, llmBiasProposer } from "../src/engine/bias.js"
import { ARC_CATALOG, solveTaskWithProposer } from "../applications/arc/llm.js"
import { identityTask } from "../applications/arc/tasks.js"
import { biasFor, solveTask } from "../applications/arc/task.js"

const validBias = {
  head_predicates: [{ name: "output", arity: 4 }],
  body_predicates: [{ name: "cell", arity: 4 }],
  max_clauses: 1, max_body_length: 1, max_variables: 4, max_recursion_depth: 2, allow_recursion: false
}
const validBiasJson = JSON.stringify(validBias)

test("the prompt carries the task and the predicate catalog", () => {
  const p = buildBiasPrompt({ description: "flip horizontally", examples: "...", catalog: ARC_CATALOG, headHint: "output/4" })
  expect(p).toContain("flip horizontally")
  expect(p).toContain("cell/4")
  expect(p).toContain("mirror_x/3")
})

test("parses a fenced JSON bias and validates it", () => {
  const text = "Here is the bias:\n```json\n" + validBiasJson + "\n```\n"
  const bias = parseBiasResponse(text)
  expect(bias.body_predicates[0].name).toBe("cell")
  expect(validateBias(bias).valid).toBe(true)
})

test("the proposer rejects an invalid bias from the model", async () => {
  const propose = llmBiasProposer({ callModel: async () => '{"body_predicates": []}', catalog: ARC_CATALOG })
  await expect(propose("x", "y")).rejects.toThrow(/invalid/)
})

test("hybrid loop: a model-proposed bias drives synthesis end to end", async () => {
  const callModel = async () => "```json\n" + validBiasJson + "\n```"
  const r = await solveTaskWithProposer(identityTask, callModel, {
    description: "copy the grid unchanged",
    max_candidates: 4000
  })
  expect(validateBias(r.bias).valid).toBe(true)
  expect(r.stats.found).toBe(true)
  expect(r.correct).toBe(true)
})

test("a scoped bias searches fewer candidates than a broad fixed one", async () => {
  const scoped = await solveTask(identityTask, biasFor(["cell"], { max_body_length: 1, max_variables: 4 }), { max_candidates: 6000 })
  const broad = await solveTask(identityTask, biasFor(["adjacent", "cell"], { max_body_length: 1, max_variables: 4 }), { max_candidates: 6000 })
  expect(scoped.correct).toBe(true)
  expect(broad.correct).toBe(true)
  expect(scoped.stats.candidates_tested).toBeLessThan(broad.stats.candidates_tested)
})
