// Copper end-to-end smoke test. Run after a meaningful change to the synthesizer:
//   bun run demo
// It synthesizes each problem from examples, then *verifies* the result by executing it
// against those examples (not by string-matching the expected program), prints a proof
// trace per example, and exits non-zero if any required problem fails. See the plan in
// project/plans/small-copper-demo-plan.md.

import { synthesize } from "copper-ilp/engine"
import { verify, makeRegistry } from "copper-ilp/core"
import { programText, atomText, traceText } from "./harness/format.js"
import second from "./problems/second.js"
import last from "./problems/last.js"

const BUDGET = { max_candidates: 10000, max_time_ms: 5000 }
const indent = (s, n = 4) => s.split("\n").map(l => " ".repeat(n) + l).join("\n")
const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length))

async function run(p, index, total) {
  const { problem } = p
  console.log(`[${index}/${total}] Synthesizing ${p.name}`)
  console.log(`Background predicates: ${p.predicateLabels}`)
  console.log(`Positive examples: ${problem.positives.length}`)
  console.log(`Negative examples: ${problem.negatives.length}`)
  console.log("\n  Searching...")

  const sol = await synthesize({ ...problem, ...BUDGET })
  const registry = makeRegistry(problem.background)
  const opts = { maxDepth: problem.bias.max_recursion_depth }

  if (!sol.stats.found) {
    console.log(`  No program found within budget (${BUDGET.max_time_ms}ms, ${BUDGET.max_candidates} candidates) after testing ${sol.stats.candidates_tested}.`)
    if (!p.required && p.expected) {
      const v = verify(p.expected, registry, problem, opts)
      console.log(`\n  ${p.skipReason}\n`)
      console.log("  Reference program (verified for context):")
      console.log(indent(programText(p.expected), 4))
      console.log(`    → ${v.correct ? "verifies against all examples" : "FAILS verification"}.`)
      console.log("\n  Result: SKIP (not reached within budget)")
      return "skip"
    }
    console.log("\n  Result: FAIL (no covering program)")
    return "fail"
  }

  console.log(`  Found program in ${sol.stats.time_ms}ms after testing ${sol.stats.candidates_tested} candidates.\n`)
  console.log("  Synthesized program:")
  console.log(indent(programText(sol.program), 4))

  console.log("\n  Verification:")
  const v = verify(sol.program, registry, problem, opts)
  let ok = true
  for (const r of v.positives) {
    if (!r.covered) ok = false
    console.log(`    ${r.covered ? "✓" : "✗"} ${pad(atomText(r.example), 24)} — ${traceText(r.proof)}`)
  }
  for (const r of v.negatives) {
    if (r.covered) ok = false
    console.log(`    ${r.covered ? "✗" : "✓"} ${pad(atomText(r.example), 24)} — ${r.covered ? "WRONGLY COVERED" : "rejected"}`)
  }
  console.log(`\n  Result: ${ok ? "PASS" : "FAIL (synthesized program does not match expected behaviour)"}`)
  return ok ? "pass" : "fail"
}

const problems = [second, last]
console.log("Copper demo\n===========\n")

const results = []
for (let i = 0; i < problems.length; i++) {
  results.push(await run(problems[i], i + 1, problems.length))
  console.log("")
}

const passed = results.filter(r => r === "pass").length
const skipped = results.filter(r => r === "skip").length
console.log("==============")
console.log(`Demo: ${passed}/${problems.length} PASS${skipped ? `, ${skipped} skipped` : ""}`)

const failedRequired = problems.some((p, i) => p.required && results[i] !== "pass")
process.exit(failedRequired ? 1 : 0)
