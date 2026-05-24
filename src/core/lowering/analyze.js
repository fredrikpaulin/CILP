// Target-agnostic lowering analysis. Resolving modes, checking well-modedness, deciding
// feasibility, and grouping clauses by head predicate are the same for every target — only
// the rendering of the result into source differs. Each target emitter (javascript.js,
// python.js, …) calls `analyze` and renders the plan in its own syntax.

// name -> modes, from the harness primitives plus any head/target modes the caller
// supplies in options.modes (the target predicate's modes come from the bias, which the
// engine merges in here).
export function modeMap(harness, options) {
  const map = new Map()
  for (const p of harness?.primitives ?? []) if (p.modes) map.set(p.name, p.modes)
  for (const [name, modes] of Object.entries(options.modes ?? {})) map.set(name, modes)
  return map
}

export const headPredicates = program => new Set(program.clauses.map(c => c.head.predicate))
const hasCompoundArg = atom => atom.args.some(a => a.type === "compound")

export const recursionCaveat = pred =>
  `${pred} is recursive; lowered as native recursion with no depth bound — relies on the data being well-founded`

// Check a clause is well-moded and within the supported subset. Returns a reason string if
// it cannot be lowered, or null if it can.
export function modeError(clause, modes) {
  const head = clause.head.predicate
  if (hasCompoundArg(clause.head) || clause.body.some(hasCompoundArg))
    return `${head}: compound arguments are not supported by the lowering`
  if (clause.head.args.some(a => a.type !== "var"))
    return `${head}: non-variable head arguments are not supported by the lowering`

  const hm = modes.get(head)
  if (!hm) return `${head}: no mode declaration`
  if (hm.length !== clause.head.args.length) return `${head}: mode/arity mismatch`

  const bound = new Set()
  clause.head.args.forEach((a, i) => { if (hm[i] === "in") bound.add(a.name) })
  for (const goal of clause.body) {
    const m = modes.get(goal.predicate)
    if (!m) return `${goal.predicate}: no mode declaration`
    if (m.length !== goal.args.length) return `${goal.predicate}: mode/arity mismatch`
    for (let i = 0; i < goal.args.length; i++) {
      const a = goal.args[i]
      if (m[i] === "in" && a.type === "var" && !bound.has(a.name))
        return `${head}: ${goal.predicate} reads unbound variable ${a.name}`
    }
    goal.args.forEach((a, i) => { if (m[i] === "out" && a.type === "var") bound.add(a.name) })
  }
  for (let i = 0; i < clause.head.args.length; i++)
    if (hm[i] === "out" && !bound.has(clause.head.args[i].name))
      return `${head}: head output ${clause.head.args[i].name} is never produced`
  return null
}

// Analyze a program for lowering. Returns either { feasible: false, reason } or
// { feasible: true, caveats, modes, heads, groups } where groups is an array of
// [predicate, clauses[]] entries — one generator per group.
export function analyze(program, harness, options = {}) {
  const modes = modeMap(harness, options)
  const heads = headPredicates(program)

  for (const clause of program.clauses) {
    const reason = modeError(clause, modes)
    if (reason) return { feasible: false, reason }
  }

  const caveats = []
  for (const clause of program.clauses)
    if (clause.body.some(g => heads.has(g.predicate))) {
      const c = recursionCaveat(clause.head.predicate)
      if (!caveats.includes(c)) caveats.push(c)
    }

  const groups = new Map()
  for (const clause of program.clauses) {
    if (!groups.has(clause.head.predicate)) groups.set(clause.head.predicate, [])
    groups.get(clause.head.predicate).push(clause)
  }
  return { feasible: true, caveats, modes, heads, groups: [...groups] }
}
