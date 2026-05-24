// Runs the benchmark suite with constraint learning on and off, and reports
// correctness and the candidate-test reduction. Run with: bun bench/run.js

import { synthesize } from "../src/engine/synthesize.js"
import { suite, toProblem } from "./suite.js"

const OFF_CAP = 20000 // bound the unpruned search so the report always finishes

function pad(s, n) { return String(s).padEnd(n) }
function padL(s, n) { return String(s).padStart(n) }

const rows = []
let sumOn = 0, sumOff = 0, allCorrect = true

for (const entry of suite) {
  const problem = toProblem(entry)

  const t1 = performance.now()
  const on = await synthesize(problem)
  const tOn = performance.now() - t1

  const t2 = performance.now()
  const off = await synthesize({ ...problem, max_candidates: OFF_CAP }, { constraints: false })
  const tOff = performance.now() - t2

  const correct = on.stats.found && on.coverage.correct
  allCorrect = allCorrect && correct
  const comparable = on.stats.found && off.stats.found
  if (comparable) { sumOn += on.stats.candidates_tested; sumOff += off.stats.candidates_tested }
  const ratio = comparable ? (off.stats.candidates_tested / on.stats.candidates_tested).toFixed(1) + "x" : "-"

  rows.push([
    entry.name,
    correct ? "ok" : "FAIL",
    on.stats.candidates_tested,
    on.stats.candidates_pruned,
    off.stats.found ? off.stats.candidates_tested : ">" + OFF_CAP,
    ratio,
    tOn.toFixed(0) + "ms"
  ])
}

console.log(pad("problem", 20), padL("tested", 7), padL("pruned", 7), padL("naive", 7), padL("ratio", 7), padL("time", 7))
console.log("-".repeat(60))
for (const r of rows) {
  console.log(pad(r[0], 20), padL(r[1] === "ok" ? r[2] : r[1], 7), padL(r[3], 7), padL(r[4], 7), padL(r[5], 7), padL(r[6], 7))
}
console.log("-".repeat(60))
console.log(`all correct: ${allCorrect}`)
console.log(`aggregate (comparable problems): ${sumOff} naive vs ${sumOn} pruned = ${(sumOff / sumOn).toFixed(1)}x reduction`)
