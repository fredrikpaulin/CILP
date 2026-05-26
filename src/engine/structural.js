// Structural coverage (#035). For the subset where a hypothesis is a *fact* — a body-less
// clause — coverage is exactly structural unification: a fact covers an example iff its
// head unifies with the example, with no background resolution. That is the one regime the
// GPU's structural-unification kernels compute directly, so this routes coverage through
// the packed representation (`unifyPacked`, the CPU oracle the Metal `coverage` kernel
// mirrors) instead of the SLD interpreter. The same operation runs on the GPU at batch
// scale via `coverageVector` — see bench/structural_gpu.js.
//
// Honest boundary (the reason #035 was deferred): coverage *with background predicates* is
// SLD resolution, not structural unification, and does not move to the GPU. This evaluator
// is for the body-less/structural subset only — it throws if handed a clause with a body —
// and the default synthesize path stays on the CPU interpreter.

import { termLayout } from "./buffer.js"
import { packTerms, makeSymbols } from "./pack.js"
import { unifyPacked } from "./ops/unify_packed.js"

const atomTerm = a => ({ type: "compound", functor: a.predicate, args: a.args })
const depth = t => (t.type === "compound" ? 1 + Math.max(0, ...t.args.map(depth)) : 0)
const arity = t => (t.type === "compound" ? t.args.length : 0)

// Coverage of a body-less program against {positives, negatives}, by structural unification
// of each clause head against each example. Returns the same shape as `coverage`.
export function structuralCoverage(program, examples, options = {}) {
  for (const c of program.clauses) {
    if (c.body.length) throw new Error("structuralCoverage is only defined for body-less (fact) clauses")
  }
  const heads = program.clauses.map(c => atomTerm(c.head))
  const posT = (examples.positives ?? []).map(atomTerm)
  const negT = (examples.negatives ?? []).map(atomTerm)
  const all = [...heads, ...posT, ...negT]
  const layout = options.layout ?? termLayout(Math.max(1, ...all.map(arity)), Math.max(2, ...all.map(depth)) + 1)
  const symbols = makeSymbols()
  const { packed: pc } = packTerms(heads, layout, { symbols })

  const coveredBy = exTerms => {
    if (!exTerms.length) return []
    const { packed: pe } = packTerms(exTerms, layout, { symbols })
    return exTerms.map((_, e) => heads.some((_, h) => unifyPacked(
      { view: pc.view, base: h * layout.intsPerTerm, slot: 0, side: "A" },
      { view: pe.view, base: e * layout.intsPerTerm, slot: 0, side: "B" },
      layout
    )))
  }

  const posMask = coveredBy(posT)
  const negMask = coveredBy(negT)
  const positives = (examples.positives ?? []).map((example, i) => ({ example, covered: posMask[i] }))
  const negatives = (examples.negatives ?? []).map((example, i) => ({ example, covered: negMask[i] }))
  return { positives, negatives, correct: positives.every(p => p.covered) && negatives.every(n => !n.covered) }
}

// A synthesize-compatible evaluator over the structural subset: pass as `options.evaluate`.
export function structuralEvaluator(examples, options = {}) {
  return program => structuralCoverage(program, examples, options)
}

// A small enumerator for the structural class: fact patterns over the head predicate where
// each argument is a fresh variable or a constant drawn from the examples, ordered by
// increasing number of constants (most general first). The variable-only Path-A enumerator
// produces no ground structure, so structural search needs its own candidate source.
export function* factPatterns(problem) {
  const head = problem.bias.head_predicates[0]
  const consts = []
  const seen = new Set()
  for (const ex of [...(problem.positives ?? []), ...(problem.negatives ?? [])]) {
    for (const a of ex.args) {
      if (a.type === "const" && !seen.has(a.value)) { seen.add(a.value); consts.push(a.value) }
    }
  }
  // choices per position: a fresh variable, or any example constant.
  const choices = i => [{ type: "var", name: `V${i}`, id: i }, ...consts.map(v => ({ type: "const", value: v }))]
  const positions = Array.from({ length: head.arity }, (_, i) => choices(i))

  const cartesian = lists => lists.reduce((acc, opts) => acc.flatMap(p => opts.map(o => [...p, o])), [[]])
  const constCount = args => args.filter(a => a.type === "const").length
  const patterns = cartesian(positions).sort((x, y) => constCount(x) - constCount(y))

  for (const args of patterns) {
    yield { clauses: [{ head: { predicate: head.name, args }, body: [] }] }
  }
}
