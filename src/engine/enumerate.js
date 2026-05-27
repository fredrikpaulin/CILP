// Path A: structured hypothesis enumeration. Generates candidate programs that fit
// the bias, lazily, in nondecreasing order of complexity — clause count first, then
// body length, then variable count. This is synthesize's default source of candidates.
//
// By default the hypothesis space is variable-only: atom arguments are variables, and
// constants enter through the examples and background. A bias may opt into a pool of
// constants (`bias.constants`), and then the enumerator also places those constants in
// body argument positions — constant-free clauses first, so a simple explanation is never
// delayed by a constant-bearing one (#043). Bodies are sets of distinct atoms, so atom
// ordering within a clause is not a source of duplicates. Clauses are generated in a
// contiguous-variable canonical form — a clause using n variables uses exactly V0..V(n-1) —
// which removes the renaming duplicates that differ only by variable-index gaps. Remaining
// renaming and clause-reordering duplicates are left to the constraint learner's `redundant`
// check (#009): the enumerator over-generates rather than risk skipping a candidate, so
// completeness holds up to renaming.
//
// Language biases prune the frontier before a candidate is ever tested. Each is sound with
// respect to the restricted space — every clause it keeps could be an answer:
//   - Connectivity (range-restriction): every body atom must share a variable, directly
//     or transitively, with the head. A body literal disjoint from the head can't
//     constrain it, so dropping such clauses loses nothing useful and removes the
//     cartesian blow-up of pairing every atom with every other. Always on. (#044)
//   - Mode-directedness: when the bias declares modes, a clause is kept only if its body
//     admits a left-to-right order in which every atom's input arguments are already
//     bound (head inputs seed the bound set; each atom binds its variables). This is the
//     same well-modedness the lowering requires, applied at enumeration time. It stops a
//     high-arity predicate like cell/4 from spraying a fresh variable into an input
//     position. A bias that declares no modes is relational and feels only connectivity. (#044)
//   - Type consistency: when predicates declare `arg_types`, a variable may occupy only
//     positions of one type, and a typed constant only positions of its type. This is what
//     keeps the search from putting a colour where a coordinate belongs — the bulk of the
//     wasted frontier for high-arity grid predicates. Untyped predicates are unconstrained. (#045)

function vars(count) {
  return Array.from({ length: count }, (_, i) => ({ type: "var", name: "V" + i }))
}

const varsOf = atom => atom.args.filter(a => a.type === "var").map(a => a.name)

// name -> modes, from the bias's head and body predicate declarations. A predicate with
// no declared mode is absent here and treated as relational by the checks below.
function biasModes(bias) {
  const m = new Map()
  for (const p of [...bias.head_predicates, ...bias.body_predicates]) if (p.mode) m.set(p.name, p.mode)
  return m
}

// name -> arg_types, from the bias's predicate declarations. Absent when a predicate
// declares no types, in which case its positions impose no type on the variables in them.
function biasTypes(bias) {
  const m = new Map()
  for (const p of [...bias.head_predicates, ...bias.body_predicates]) if (p.arg_types) m.set(p.name, p.arg_types)
  return m
}

// Does every variable keep a single type across the clause? A variable takes the type of
// the first typed position it appears in; it is inconsistent if it later lands in a position
// of a different type. Untyped positions impose nothing; constants are filtered to matching
// positions at generation, so they need no check here.
function typeConsistent(head, body, types) {
  const vt = new Map()
  for (const atom of [head, ...body]) {
    const ts = types.get(atom.predicate)
    if (!ts) continue
    for (let i = 0; i < atom.args.length; i++) {
      const a = atom.args[i], t = ts[i]
      if (t === undefined || a.type !== "var") continue
      if (vt.has(a.name) && vt.get(a.name) !== t) return false
      vt.set(a.name, t)
    }
  }
  return true
}

// Is every body atom connected, directly or transitively, to the head? Grow the head's
// variable set by any atom sharing a variable with it, to a fixpoint; connected iff every
// atom was absorbed. An empty body is connected vacuously.
function connected(head, body) {
  const comp = new Set(varsOf(head))
  const placed = new Array(body.length).fill(false)
  let changed = true
  while (changed) {
    changed = false
    body.forEach((atom, i) => {
      if (placed[i]) return
      const vs = varsOf(atom)
      if (vs.some(v => comp.has(v))) { vs.forEach(v => comp.add(v)); placed[i] = true; changed = true }
    })
  }
  return placed.every(Boolean)
}

// Does some left-to-right order make every body atom well-moded? Head input args (or all
// head args, when the head declares no mode) seed the bound set; an atom is placeable when
// its declared input variables are all bound, and placing it binds all its variables.
// Predicates with no mode have no input requirement. Greedy placement is complete: binding
// only grows, so an atom placeable later is placeable now.
function wellModedFeasible(head, body, modes) {
  const hm = modes.get(head.predicate)
  const bound = new Set(
    hm ? head.args.filter((a, i) => hm[i] === "in" && a.type === "var").map(a => a.name) : varsOf(head)
  )
  const remaining = body.slice()
  let changed = true
  while (changed) {
    changed = false
    for (let i = remaining.length - 1; i >= 0; i--) {
      const atom = remaining[i]
      const m = modes.get(atom.predicate)
      const inVars = m ? atom.args.filter((a, j) => m[j] === "in" && a.type === "var").map(a => a.name) : []
      if (inVars.every(v => bound.has(v))) {
        varsOf(atom).forEach(v => bound.add(v))
        remaining.splice(i, 1)
        changed = true
      }
    }
  }
  return remaining.length === 0
}

// Cartesian product of per-position candidate pools, varying the first position fastest
// (so with uniform pools it matches the old all-variable tuple order exactly).
function* productPerPos(pools) {
  if (pools.length === 0) { yield []; return }
  const [head, ...rest] = pools
  for (const tail of productPerPos(rest)) for (const item of head) yield [item, ...tail]
}

const hasConst = atom => atom.args.some(a => a.type === "const")

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

// Every body atom for the given predicates over variables V0..V(n-1). With a constants
// pool, each position also draws the type-matching constants (an untyped position, or an
// untyped constant, matches anything), so atoms placing a constant are generated too.
function atomsOver(predicates, n, constants = []) {
  const vpool = vars(n)
  const atoms = []
  for (const p of predicates) {
    const pools = Array.from({ length: p.arity }, (_, i) => {
      if (!constants.length) return vpool
      const ts = p.arg_types
      const ok = constants.filter(c => !ts || ts[i] === undefined || c.type === undefined || c.type === ts[i])
      return [...vpool, ...ok.map(c => ({ type: "const", value: c.value }))]
    })
    for (const args of productPerPos(pools)) atoms.push({ predicate: p.name, args })
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

// A candidate survives the language biases: it uses exactly V0..V(n-1) (the canonical form),
// is connected to its head, admits a well-moded ordering (when modes are declared), and is
// type-consistent (when types are declared).
function keep(head, body, n, modes, types) {
  return usesExactly({ head, body }, n) &&
    connected(head, body) &&
    wellModedFeasible(head, body, modes) &&
    typeConsistent(head, body, types)
}

// Single clauses in order of body length, then variable count, then — when the bias supplies
// a constants pool — constant-free clauses before constant-bearing ones, so a simple
// explanation is never delayed by a constant.
export function* enumerateClauses(bias) {
  const heads = bias.head_predicates
  const modes = biasModes(bias)
  const types = biasTypes(bias)
  const constants = bias.constants ?? []
  const bodyPredicates = [
    ...bias.body_predicates,
    ...(bias.allow_recursion ? bias.head_predicates : [])
  ]
  for (let length = 0; length <= bias.max_body_length; length++) {
    for (const head of heads) {
      const headAtom = { predicate: head.name, args: vars(head.arity) }
      for (let n = head.arity; n <= bias.max_variables; n++) {
        const varUniverse = atomsOver(bodyPredicates, n)
        for (const body of combinations(varUniverse, length)) {
          if (keep(headAtom, body, n, modes, types)) yield { head: headAtom, body }
        }
        if (!constants.length) continue
        // Then the constant-bearing clauses (at least one atom carries a constant); the
        // constant-free combinations above are skipped here so they are not repeated.
        const fullUniverse = atomsOver(bodyPredicates, n, constants)
        for (const body of combinations(fullUniverse, length)) {
          if (!body.some(hasConst)) continue
          if (keep(headAtom, body, n, modes, types)) yield { head: headAtom, body }
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
