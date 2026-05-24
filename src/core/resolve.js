// SLD resolution over a JSON program, implemented as a generator. Backtracking is
// implicit: when the caller asks for the next solution, the generator resumes from
// the last choice point. This is copper-core's reference interpreter (Appendix A
// §A.4) — the meaning of a JSON program is whatever this yields.
//
// `maxDepth` caps the number of program-clause expansions along a derivation
// branch; background-predicate calls do not count. It is a conservative
// termination guard, not a true per-predicate recursion-depth measure (#034).

import { unify, applySubstitution } from "./unify.js"

function unifyArgs(a, b, sub) {
  let s = sub
  for (let i = 0; i < a.length; i++) {
    s = unify(a[i], b[i], s)
    if (s === null) return null
  }
  return s
}

function maxIdInTerm(t, cur) {
  if (t.type === "var") return Math.max(cur, t.id ?? 0)
  if (t.type === "compound") return t.args.reduce((c, a) => maxIdInTerm(a, c), cur)
  return cur
}

function maxIdInAtom(a, cur) {
  return a.args.reduce((c, t) => maxIdInTerm(t, c), cur)
}

function maxId(program, query) {
  let m = maxIdInAtom(query, 0)
  for (const clause of program.clauses) {
    m = maxIdInAtom(clause.head, m)
    for (const goal of clause.body) m = maxIdInAtom(goal, m)
  }
  return m
}

// Copy a clause with all its variables renamed to fresh ids, so reusing a clause
// (including recursively) never clashes with the query's or another instance's
// variables. This is "standardizing apart."
function renameClause(clause, fresh) {
  const seen = new Map()
  const renameTerm = t => {
    if (t.type === "var") {
      if (!seen.has(t.id)) seen.set(t.id, { type: "var", name: t.name, id: fresh() })
      return seen.get(t.id)
    }
    if (t.type === "compound") return { ...t, args: t.args.map(renameTerm) }
    return t
  }
  const renameAtom = a => ({ ...a, args: a.args.map(renameTerm) })
  return { head: renameAtom(clause.head), body: clause.body.map(renameAtom) }
}

function* step(goals, program, registry, sub, depth, maxDepth, fresh) {
  if (goals.length === 0) {
    yield sub
    return
  }
  const [goal, ...rest] = goals

  if (registry.has(goal.predicate)) {
    for (const s of registry.solve(goal.predicate, goal.args, sub)) {
      yield* step(rest, program, registry, s, depth, maxDepth, fresh)
    }
    return
  }

  if (depth >= maxDepth) return // refuse to descend further

  for (const clause of program.clauses) {
    if (clause.head.predicate !== goal.predicate) continue
    if (clause.head.args.length !== goal.args.length) continue
    const renamed = renameClause(clause, fresh)
    const s = unifyArgs(goal.args, renamed.head.args, sub)
    if (s === null) continue
    yield* step([...renamed.body, ...rest], program, registry, s, depth + 1, maxDepth, fresh)
  }
}

// Run `query` (an Atom) against `program`, dispatching background predicates to
// `registry`. Yields a substitution for each solution, lazily.
export function* interpret(program, registry, query, options = {}) {
  const maxDepth = options.maxDepth ?? 50
  let next = maxId(program, query) + 1
  const fresh = () => next++
  yield* step([query], program, registry, new Map(), 0, maxDepth, fresh)
}

function applySubAtom(atom, sub) {
  return { predicate: atom.predicate, args: atom.args.map(t => applySubstitution(t, sub)) }
}

// Like `step`, but threads a proof trace: each resolved goal appends a node recording
// the (partially) ground atom and how it was discharged — a clause head expansion or a
// background fact. Yields { sub, trace } at each full solution; backtracking copies the
// trace per branch so it never leaks across choice points.
function* stepProof(goals, program, registry, sub, depth, maxDepth, fresh, trace) {
  if (goals.length === 0) {
    yield { sub, trace }
    return
  }
  const [goal, ...rest] = goals

  if (registry.has(goal.predicate)) {
    for (const s of registry.solve(goal.predicate, goal.args, sub)) {
      yield* stepProof(rest, program, registry, s, depth, maxDepth, fresh,
        [...trace, { goal: applySubAtom(goal, s), via: "background" }])
    }
    return
  }

  if (depth >= maxDepth) return

  for (let ci = 0; ci < program.clauses.length; ci++) {
    const clause = program.clauses[ci]
    if (clause.head.predicate !== goal.predicate) continue
    if (clause.head.args.length !== goal.args.length) continue
    const renamed = renameClause(clause, fresh)
    const s = unifyArgs(goal.args, renamed.head.args, sub)
    if (s === null) continue
    yield* stepProof([...renamed.body, ...rest], program, registry, s, depth + 1, maxDepth, fresh,
      [...trace, { goal: applySubAtom(goal, s), via: "clause", clause: ci }])
  }
}

// The first derivation of `goal` as a flat proof trace, or { covered: false }. The
// trace lists the ground atoms that fired along the successful branch — clause heads
// and the witnessing background facts — fully grounded by the final substitution. It
// is evidence the program entails the goal, checkable by re-running it.
export function firstProof(program, registry, goal, options = {}) {
  const maxDepth = options.maxDepth ?? 50
  let next = maxId(program, goal) + 1
  const fresh = () => next++
  for (const { sub, trace } of stepProof([goal], program, registry, new Map(), 0, maxDepth, fresh, [])) {
    return { covered: true, trace: trace.map(e => ({ goal: applySubAtom(e.goal, sub), via: e.via })) }
  }
  return { covered: false, trace: null }
}
