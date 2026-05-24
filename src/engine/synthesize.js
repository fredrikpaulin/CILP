// The synthesizer's entry point. Validates a problem, resolves its background,
// then runs a search loop: pull candidate programs from an enumerator, test each
// against the examples with the coverage harness, and return the first acceptable
// one — or the best seen — within budget.
//
// The structured enumerator lands in #008; until then, pass options.enumerate to
// supply candidates. Constraint-driven pruning of the search is wired in at #010.

import { validate } from "../core/schema.js"
import { makeRegistry, loadBackground } from "../core/background.js"
import { coverage } from "../core/verify.js"
import { enumerate as defaultEnumerate } from "./enumerate.js"
import { makeConstraints } from "./constrain.js"

// Background may be a module path (the canonical, serializable form), an existing
// registry, or a plain predicates object (both for in-process embedding).
async function resolveBackground(background) {
  if (typeof background === "string") return loadBackground(background)
  if (background && typeof background.solve === "function") return background
  if (background && typeof background === "object") return makeRegistry(background)
  throw new Error("problem.background must be a module path or a predicates object")
}

function score(cov) {
  const covPos = cov.positives.filter(p => p.covered).length
  const covNeg = cov.negatives.filter(n => n.covered).length
  return covPos - covNeg
}

// Acceptable when enough positives are covered and few enough negatives are.
// target_coverage defaults to 1.0 (cover every positive); noise_tolerance to 0
// (cover no negative) — the classic ILP criterion.
function acceptable(cov, targetCoverage, noiseTolerance) {
  const total = cov.positives.length
  const covPos = cov.positives.filter(p => p.covered).length
  const covNeg = cov.negatives.filter(n => n.covered).length
  const positivesOk = total === 0 ? true : covPos / total >= targetCoverage
  const negativesOk = covNeg <= noiseTolerance
  return positivesOk && negativesOk
}

function solution(program, cov, tested, pruned, start, exhausted, found) {
  return {
    program,
    coverage: cov,
    stats: {
      candidates_tested: tested,
      candidates_pruned: pruned,
      time_ms: Date.now() - start,
      search_exhausted: exhausted,
      found
    }
  }
}

export async function synthesize(problem, options = {}) {
  const check = validate(problem, "problem")
  if (!check.valid) throw new Error(`invalid problem: ${check.errors.join("; ")}`)

  const registry = await resolveBackground(problem.background)
  const enumerate = options.enumerate ?? defaultEnumerate
  const constraints = options.constraints === false ? null : makeConstraints(problem)

  const targetCoverage = problem.target_coverage ?? 1.0
  const noiseTolerance = problem.noise_tolerance ?? 0
  const maxCandidates = problem.max_candidates ?? Infinity
  const maxTimeMs = problem.max_time_ms ?? Infinity
  const examples = { positives: problem.positives, negatives: problem.negatives }
  const evalOptions = { maxDepth: problem.bias.max_recursion_depth }

  const start = Date.now()
  let tested = 0
  let pruned = 0
  let best = null
  let exhausted = true

  for (const candidate of enumerate(problem)) {
    if (tested >= maxCandidates || Date.now() - start >= maxTimeMs) {
      exhausted = false
      break
    }
    if (constraints && constraints.prune(candidate)) {
      pruned++
      continue
    }
    tested++
    const cov = coverage(candidate, registry, examples, evalOptions)
    if (constraints) constraints.learn(candidate, cov)
    if (best === null || score(cov) > score(best.coverage)) {
      best = { program: candidate, coverage: cov }
    }
    if (acceptable(cov, targetCoverage, noiseTolerance)) {
      return solution(candidate, cov, tested, pruned, start, false, true)
    }
  }

  return solution(best?.program ?? null, best?.coverage ?? null, tested, pruned, start, exhausted, false)
}
