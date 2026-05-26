// The synthesizer's entry point. Validates a problem, resolves its background, then
// runs a search loop: pull candidate programs from an enumerator, test each against the
// examples with the coverage harness, and return the first acceptable one — or the best
// seen — within budget.
//
// The loop is factored as an *anytime* generator (`search`): it yields an improved
// solution whenever the best candidate gets better, a heartbeat periodically, and
// exactly one terminal step. `synthesize` consumes it to the terminal and returns that
// (the original behaviour); `synthesizeStream` exposes the progression for the streaming
// server (#028). Constraint-driven pruning is wired in at #010.

import { validate } from "../core/schema.js"
import { makeRegistry, loadBackground } from "../core/background.js"
import { coverage } from "../core/verify.js"
import { lower } from "../core/lowering/index.js"
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

function solution(program, cov, tested, pruned, start, exhausted, found, targetSkipped = 0) {
  return {
    program,
    coverage: cov,
    stats: {
      candidates_tested: tested,
      candidates_pruned: pruned,
      candidates_target_skipped: targetSkipped,
      time_ms: Date.now() - start,
      search_exhausted: exhausted,
      found
    }
  }
}

// Modes the lowering needs, gathered from the bias's predicate declarations (head and
// body). Used only for target-biased synthesis; SQL ignores them, JS/Python require them.
function biasModes(problem) {
  const decls = [...(problem.bias.head_predicates ?? []), ...(problem.bias.body_predicates ?? [])]
  return Object.fromEntries(decls.filter(p => p.mode).map(p => [p.name, p.mode]))
}

// Validate, resolve background, and assemble the search parameters.
async function prepare(problem, options) {
  const check = validate(problem, "problem")
  if (!check.valid) throw new Error(`invalid problem: ${check.errors.join("; ")}`)
  const registry = await resolveBackground(problem.background)

  // Target-biased synthesis (#032): when the agent declares a target, a covering
  // candidate is only accepted if it also lowers cleanly to that target. The gate reuses
  // the lowering's own feasibility report, so the bias and the lowering can never disagree.
  const target = options.target ?? null
  const modes = target ? biasModes(problem) : null
  const targetGate = target
    ? candidate => lower(candidate, null, { target, modes }).metadata.feasibility !== "infeasible"
    : () => true

  const examples = { positives: problem.positives, negatives: problem.negatives }
  const evalOptions = { maxDepth: problem.bias.max_recursion_depth }
  // The coverage evaluator. Default is the CPU SLD interpreter; a caller can inject an
  // alternative — e.g. the packed structural evaluator (#035), which routes coverage
  // through the GPU-eligible representation for the body-less/structural subset.
  const evaluate = options.evaluate ?? (candidate => coverage(candidate, registry, examples, evalOptions))

  return {
    registry,
    enumerate: options.enumerate ?? defaultEnumerate,
    constraints: options.constraints === false ? null : makeConstraints(problem),
    targetGate,
    evaluate,
    targetCoverage: problem.target_coverage ?? 1.0,
    noiseTolerance: problem.noise_tolerance ?? 0,
    maxCandidates: problem.max_candidates ?? Infinity,
    maxTimeMs: problem.max_time_ms ?? Infinity,
    examples,
    evalOptions
  }
}

const HEARTBEAT = 256

// The anytime search loop. Yields { done, improved, solution }: an improvement each time
// the best candidate gets strictly better, a heartbeat every HEARTBEAT candidates, and
// exactly one terminal step (done: true). The terminal solution is what `synthesize`
// returns; the improvements are the best-so-far the streaming server emits.
function* search(prepared, problem) {
  const { enumerate, constraints, targetGate, evaluate, targetCoverage, noiseTolerance, maxCandidates, maxTimeMs } = prepared
  const start = Date.now()
  let tested = 0, pruned = 0, skipped = 0, best = null

  for (const candidate of enumerate(problem)) {
    if (tested >= maxCandidates || Date.now() - start >= maxTimeMs) {
      yield { done: true, improved: false, solution: solution(best?.program ?? null, best?.coverage ?? null, tested, pruned, start, false, false, skipped) }
      return
    }
    if (constraints && constraints.prune(candidate)) { pruned++; continue }
    tested++
    const cov = evaluate(candidate)
    if (constraints) constraints.learn(candidate, cov)

    let improved = false
    if (best === null || score(cov) > score(best.coverage)) { best = { program: candidate, coverage: cov }; improved = true }

    if (acceptable(cov, targetCoverage, noiseTolerance)) {
      // Under target-biased synthesis, a covering candidate that wouldn't lower cleanly to
      // the declared target is skipped, and the search keeps looking for one that does.
      if (targetGate(candidate)) {
        yield { done: true, improved: true, solution: solution(candidate, cov, tested, pruned, start, false, true, skipped) }
        return
      }
      skipped++
    }
    if (improved) yield { done: false, improved: true, solution: solution(candidate, cov, tested, pruned, start, false, false, skipped) }
    else if (tested % HEARTBEAT === 0) yield { done: false, improved: false, solution: solution(best?.program ?? null, best?.coverage ?? null, tested, pruned, start, false, false, skipped) }
  }
  yield { done: true, improved: false, solution: solution(best?.program ?? null, best?.coverage ?? null, tested, pruned, start, true, false, skipped) }
}

export async function synthesize(problem, options = {}) {
  const prepared = await prepare(problem, options)
  for (const step of search(prepared, problem)) if (step.done) return step.solution
}

// The search progression as an async generator: yields each { done, improved, solution }
// step. Consumers pull at their own pace and may stop early (the search stops with them).
export async function* synthesizeStream(problem, options = {}) {
  const prepared = await prepare(problem, options)
  yield* search(prepared, problem)
}
