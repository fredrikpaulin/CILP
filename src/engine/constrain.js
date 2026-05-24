// The constraint learner. When a candidate fails, derive a constraint explaining
// why, and use it to prune related candidates without testing them. Four types,
// following the architecture (§3.3):
//
//   too_general(H)    — H entails too many negatives. Any clause-superset of H is
//                       at least as general, so it over-covers too. Prune supersets.
//   too_specific(C)   — a single clause C misses a positive. Any specialization of C
//                       (more body literals) misses it too. Prune specializations.
//   unsatisfiable(C)  — C is unsatisfiable for structural (type) reasons. Prune any
//                       program containing it.
//   redundant(H1,H2)  — H1 and H2 are equal up to variable renaming and clause
//                       reordering. Canonicalize and dedupe.
//
// Constraints are sound: a pruned candidate provably can't be a solution that an
// already-considered or simpler candidate isn't. The matching is renaming-invariant
// via canonical forms; theta-subsumption (too_specific) is complete for these clauses
// but bounded, since variable counts are small.

// --- rendering ---------------------------------------------------------------

function termString(t) {
  if (t.type === "var") return t.name
  if (t.type === "const") return "c" + JSON.stringify(t.value)
  return t.functor + "(" + t.args.map(termString).join(",") + ")"
}

function atomString(atom) {
  return atom.predicate + "(" + atom.args.map(termString).join(",") + ")"
}

// --- variables ---------------------------------------------------------------

function termVars(t, out) {
  if (t.type === "var") out.push(t.name)
  else if (t.type === "compound") t.args.forEach(a => termVars(a, out))
}

function atomVars(atom) {
  const out = []
  atom.args.forEach(t => termVars(t, out))
  return out
}

function* permutations(arr) {
  if (arr.length <= 1) { yield arr.slice(); return }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
    for (const p of permutations(rest)) yield [arr[i], ...p]
  }
}

function renameTerm(t, map) {
  if (t.type === "var") return map.has(t.name) ? { type: "var", name: map.get(t.name) } : t
  if (t.type === "compound") return { ...t, args: t.args.map(a => renameTerm(a, map)) }
  return t
}

function renameAtom(atom, map) {
  return { predicate: atom.predicate, args: atom.args.map(t => renameTerm(t, map)) }
}

// --- canonical forms ---------------------------------------------------------

// Head variables stay fixed (they map to example argument positions, so renaming
// them would change meaning). Body-only variables are renamed to a canonical order
// chosen as the lexicographically smallest rendering; body atoms are sorted. The
// result identifies clauses equal up to body-variable renaming and atom reordering.
export function canonicalClause(clause) {
  const headVars = new Set(atomVars(clause.head))
  const bodyOnly = [...new Set(clause.body.flatMap(atomVars))].filter(n => !headVars.has(n))
  let best = null
  for (const perm of permutations(bodyOnly)) {
    const map = new Map()
    perm.forEach((name, i) => map.set(name, "W" + i))
    const head = atomString(renameAtom(clause.head, map))
    const body = clause.body.map(a => atomString(renameAtom(a, map))).sort()
    const str = head + " :- " + body.join(", ")
    if (best === null || str < best) best = str
  }
  return best
}

// A program is a set of clauses, each independently renamable, in any order.
export function canonicalProgram(program) {
  return program.clauses.map(canonicalClause).sort().join(" | ")
}

// --- theta-subsumption (too_specific) ----------------------------------------

// Does clause C theta-subsume clause D? (C is more general; D is a specialization.)
// True iff some variable substitution makes C's head equal D's head and C's body a
// subset of D's body. Heads are aligned positionally; body-only variables of C are
// searched over D's variables.
export function subsumes(c, d) {
  if (c.head.predicate !== d.head.predicate) return false
  if (c.head.args.length !== d.head.args.length) return false

  // Align heads positionally. Variable-only heads (the common case) fix a mapping
  // from C's head variables to D's; a constant must match exactly.
  const map = new Map()
  for (let i = 0; i < c.head.args.length; i++) {
    const cv = c.head.args[i], dv = d.head.args[i]
    if (cv.type === "var") {
      const target = termString(dv)
      if (map.has(cv.name) && map.get(cv.name) !== target) return false
      map.set(cv.name, target)
    } else if (termString(cv) !== termString(dv)) {
      return false
    }
  }

  const headVars = new Set(atomVars(c.head))
  const bodyOnly = [...new Set(c.body.flatMap(atomVars))].filter(n => !headVars.has(n))
  const dVars = [...new Set([...atomVars(d.head), ...d.body.flatMap(atomVars)])]
  const dBody = new Set(d.body.map(atomString))

  const search = i => {
    if (i === bodyOnly.length) {
      return c.body.every(a => dBody.has(atomString(renameAtom(a, map))))
    }
    for (const target of dVars) {
      map.set(bodyOnly[i], target)
      if (search(i + 1)) return true
    }
    map.delete(bodyOnly[i])
    return false
  }
  return search(0)
}

// --- unsatisfiable (type conflict) -------------------------------------------

function buildPredTypes(bias) {
  const map = new Map()
  for (const decl of [...bias.head_predicates, ...bias.body_predicates]) {
    if (decl.arg_types) map.set(decl.name, decl.arg_types)
  }
  return map
}

// A clause is unsatisfiable when a variable is required to hold two different types
// across the predicate positions it occupies. With no type declarations, this never
// fires. (Richer unsatisfiability — true logical contradiction — arrives with Path B's
// ASP encoding.)
export function isTypeUnsatisfiable(clause, predTypes) {
  const varTypes = new Map()
  const consider = atom => {
    const types = predTypes.get(atom.predicate)
    if (!types) return
    atom.args.forEach((t, i) => {
      if (t.type === "var" && types[i] !== undefined) {
        if (!varTypes.has(t.name)) varTypes.set(t.name, new Set())
        varTypes.get(t.name).add(types[i])
      }
    })
  }
  consider(clause.head)
  clause.body.forEach(consider)
  for (const set of varTypes.values()) if (set.size > 1) return true
  return false
}

// --- the store ---------------------------------------------------------------

export function makeConstraints(problem) {
  const noise = problem.noise_tolerance ?? 0
  const predTypes = buildPredTypes(problem.bias)
  const seen = new Set()
  const tooGeneralSets = [] // each: array of canonical clause strings
  const tooSpecificClauses = [] // each: a clause object

  const clauseKeys = program => program.clauses.map(canonicalClause)

  function prune(program) {
    if (program.clauses.some(c => isTypeUnsatisfiable(c, predTypes))) return true
    if (seen.has(canonicalProgram(program))) return true
    const keys = clauseKeys(program)
    for (const set of tooGeneralSets) {
      if (set.every(s => keys.includes(s))) return true
    }
    if (program.clauses.length === 1) {
      for (const tc of tooSpecificClauses) {
        if (subsumes(tc, program.clauses[0])) return true
      }
    }
    return false
  }

  function learn(program, cov) {
    seen.add(canonicalProgram(program))
    const covN = cov.negatives.filter(n => n.covered).length
    const covP = cov.positives.filter(p => p.covered).length
    if (covN > noise) tooGeneralSets.push(clauseKeys(program))
    if (cov.positives.length > 0 && covP < cov.positives.length && program.clauses.length === 1) {
      tooSpecificClauses.push(program.clauses[0])
    }
  }

  return { prune, learn }
}
