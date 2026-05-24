// Coverage evaluation and verification. `coverage` answers the yes/no question the
// search needs on its hot path; `verify` produces the per-example proof traces that
// make a synthesized program *evidence* — the witnessing facts behind each positive,
// and confirmation that each negative derives nothing. Verification re-executes the
// program on the examples (cost proportional to the example count and proof size, not
// the search space) — and it certifies coverage on the *given* examples, which is not
// the same as generalization to unseen inputs.

import { interpret, firstProof } from "./resolve.js"
import { normalize } from "./normalize.js"

// Does `program` entail the (ground) example atom under the given background?
// Expects a normalized program (variables carry ids).
export function covers(program, registry, example, options = {}) {
  for (const _solution of interpret(program, registry, example, options)) return true
  return false
}

// Evaluate a program against positive and negative examples. Returns per-example
// coverage and whether the program is correct: covers every positive, no negative.
export function coverage(program, registry, examples = {}, options = {}) {
  const normProgram = normalize(program).value
  const check = example => covers(normProgram, registry, normalize(example).value, options)
  const positives = (examples.positives ?? []).map(example => ({ example, covered: check(example) }))
  const negatives = (examples.negatives ?? []).map(example => ({ example, covered: check(example) }))
  const correct = positives.every(p => p.covered) && negatives.every(n => !n.covered)
  return { positives, negatives, correct }
}

// Verify a program against examples, with a proof trace per example. Each positive
// that holds carries the trace of ground atoms that witnessed it; each example that
// doesn't hold has covered: false and no trace. `correct` is true when every positive
// holds and no negative does.
export function verify(program, registry, examples = {}, options = {}) {
  const normProgram = normalize(program).value
  const check = example => {
    const { covered, trace } = firstProof(normProgram, registry, normalize(example).value, options)
    return { example, covered, proof: trace }
  }
  const positives = (examples.positives ?? []).map(check)
  const negatives = (examples.negatives ?? []).map(check)
  const correct = positives.every(p => p.covered) && negatives.every(n => !n.covered)
  return { positives, negatives, correct }
}
