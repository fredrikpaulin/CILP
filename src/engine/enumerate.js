// Path A: structured hypothesis enumeration. Generates candidate programs that fit
// the bias, lazily, in nondecreasing order of complexity — clause count first, then
// body length, then variable count. This is synthesize's default source of candidates.
//
// The hypothesis space is variable-only clauses: atom arguments are variables, never
// constants (constants enter through the examples and background). Bodies are sets of
// distinct atoms, so atom ordering within a clause is not a source of duplicates.
// Clauses are generated in a contiguous-variable canonical form — a clause using n
// variables uses exactly V0..V(n-1) — which removes the renaming duplicates that
// differ only by variable-index gaps. Remaining renaming and clause-reordering
// duplicates are left to the constraint learner's `redundant` check (#009): the
// enumerator over-generates rather than risk skipping a candidate, so completeness
// holds up to renaming.

function vars(count) {
  return Array.from({ length: count }, (_, i) => ({ type: "var", name: "V" + i }))
}

// All k-tuples (with repetition) of items.
function* tuples(items, k) {
  if (k === 0) { yield []; return }
  for (const rest of tuples(items, k - 1)) {
    for (const item of items) yield [item, ...rest]
  }
}

// Lazy lexicographic k-combinations of an array (distinct elements, by index).
function* combinations(arr, k) {
  const n = arr.length
  if (k < 0 || k > n) return
  const idx = Array.from({ length: k }, (_, i) => i)
  while (true) {
    yield idx.map(i => arr[i])
    let i = k - 1
    while (i >= 0 && idx[i] === n - k + i) i--
    if (i < 0) return
    idx[i]++
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1
  }
}

// Every body atom for the given predicates over variables V0..V(n-1).
function atomsOver(predicates, n) {
  const pool = vars(n)
  const atoms = []
  for (const p of predicates) {
    for (const args of tuples(pool, p.arity)) atoms.push({ predicate: p.name, args })
  }
  return atoms
}

function clauseVariableNames(clause) {
  const names = new Set()
  const visit = t => {
    if (t.type === "var") names.add(t.name)
    else if (t.type === "compound") t.args.forEach(visit)
  }
  clause.head.args.forEach(visit)
  for (const atom of clause.body) atom.args.forEach(visit)
  return names
}

// Does the clause use exactly the variables V0..V(n-1)? Generating only this
// contiguous form means each clause shape appears once, at its true variable count.
function usesExactly(clause, n) {
  const names = clauseVariableNames(clause)
  if (names.size !== n) return false
  for (let i = 0; i < n; i++) if (!names.has("V" + i)) return false
  return true
}

// Single clauses in order of body length, then variable count.
export function* enumerateClauses(bias) {
  const heads = bias.head_predicates
  const bodyPredicates = [
    ...bias.body_predicates,
    ...(bias.allow_recursion ? bias.head_predicates : [])
  ]
  for (let length = 0; length <= bias.max_body_length; length++) {
    for (const head of heads) {
      const headAtom = { predicate: head.name, args: vars(head.arity) }
      for (let n = head.arity; n <= bias.max_variables; n++) {
        const universe = atomsOver(bodyPredicates, n)
        for (const body of combinations(universe, length)) {
          const clause = { head: headAtom, body }
          if (usesExactly(clause, n)) yield clause
        }
      }
    }
  }
}

// Candidate programs: clause count first (1..max_clauses), then by clause complexity.
// Single-clause programs stream lazily; multi-clause programs need the clause set,
// which is materialized only once the single-clause stream is exhausted.
export function* enumerate(problem) {
  const bias = problem.bias
  const maxClauses = bias.max_clauses

  if (maxClauses >= 1) {
    for (const clause of enumerateClauses(bias)) yield { clauses: [clause] }
  }
  if (maxClauses >= 2) {
    const clauses = [...enumerateClauses(bias)]
    for (let count = 2; count <= maxClauses; count++) {
      for (const combo of combinations(clauses, count)) yield { clauses: combo }
    }
  }
}
