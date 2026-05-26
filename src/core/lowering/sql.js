// SQL lowering. Unlike the JavaScript and Python targets — which compile clauses into
// mode-directed control flow — SQL is relational, so a clause maps to a query: each head
// predicate becomes a view, each body goal a relation in the FROM, a shared variable a join
// equality, a constant a filter, and the head arguments the projected columns (c0, c1, …).
// Multiple clauses for a predicate UNION together; linear self-recursion becomes a
// `WITH RECURSIVE` CTE. The JSON interpreter is still the reference semantics.
//
// SQL has a narrower envelope than the host-language targets, and the feasibility report
// says so plainly rather than emit wrong SQL: no compound terms (SQL is flat), only
// range-restricted ("safe") rules where every head variable is bound by the body, and only
// single-predicate linear recursion — non-linear or mutual recursion is reported infeasible.
// Modes are not required: SQL derives data flow from joins, not from in/out directions.
//
// SQL lowering expects each primitive relation to exist as a table with columns c0…c{arity-1}.

import { headPredicates, hasCompoundArg } from "./analyze.js"

const lit = value =>
  typeof value === "string" ? `'${value.replace(/'/g, "''")}'`
    : typeof value === "boolean" ? (value ? 1 : 0)
      : value

const infeasible = reason => ({
  source: null,
  metadata: { target: "sql", feasibility: "infeasible", caveats: [], reason, imports: [], entrypoints: [] }
})

// Build the SELECT for one clause. `relationOf(pred)` names the relation a body goal reads
// — a base table, another view, or the recursive CTE alias.
function emitSelect(clause, relationOf) {
  const occ = new Map() // var name -> [{ t, c }]
  const where = []
  clause.body.forEach((goal, ti) => {
    goal.args.forEach((arg, ci) => {
      if (arg.type === "var") {
        if (!occ.has(arg.name)) occ.set(arg.name, [])
        occ.get(arg.name).push({ t: ti, c: ci })
      } else {
        where.push(`t${ti}.c${ci} = ${lit(arg.value)}`)
      }
    })
  })
  for (const places of occ.values())
    for (let k = 1; k < places.length; k++)
      where.push(`t${places[0].t}.c${places[0].c} = t${places[k].t}.c${places[k].c}`)

  const select = clause.head.args.map((a, k) => {
    const p = occ.get(a.name)[0] // feasibility guarantees the head var occurs in the body
    return `t${p.t}.c${p.c} AS c${k}`
  })
  const from = clause.body.map((g, ti) => `${relationOf(g.predicate)} AS t${ti}`)
  return `SELECT ${select.join(", ")} FROM ${from.join(", ")}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`
}

// A topological order of the head predicates by their non-recursive dependencies (a view
// must be defined after the views it reads). Returns null if there is a cycle other than a
// direct self-loop — i.e. mutual recursion, which has no plain recursive-CTE form here.
function topoOrder(preds, depsOf) {
  const order = []
  const state = new Map() // pred -> "open" | "done"
  let cyclic = false
  const visit = p => {
    if (state.get(p) === "done") return
    if (state.get(p) === "open") { cyclic = true; return }
    state.set(p, "open")
    for (const d of depsOf(p)) if (d !== p && preds.has(d)) visit(d)
    state.set(p, "done")
    order.push(p)
  }
  for (const p of preds) visit(p)
  return cyclic ? null : order
}

export function lowerSql(program, harness, options = {}) {
  const heads = headPredicates(program)

  // Per-clause feasibility: flat terms, variable head args, range-restriction, linearity.
  for (const clause of program.clauses) {
    const head = clause.head.predicate
    if (hasCompoundArg(clause.head) || clause.body.some(hasCompoundArg))
      return infeasible(`${head}: compound arguments are not expressible in SQL`)
    if (clause.head.args.some(a => a.type !== "var"))
      return infeasible(`${head}: non-variable head arguments are not supported by the SQL lowering`)
    const bodyVars = new Set()
    for (const goal of clause.body) for (const a of goal.args) if (a.type === "var") bodyVars.add(a.name)
    for (const a of clause.head.args)
      if (!bodyVars.has(a.name))
        return infeasible(`${head}: unsafe rule — head variable ${a.name} is not bound by the body`)
    if (clause.body.filter(g => g.predicate === head).length > 1)
      return infeasible(`${head}: non-linear recursion (more than one recursive call) is not expressible as a SQL recursive CTE`)
  }

  // Group clauses by head predicate and classify recursion.
  const groups = new Map()
  for (const clause of program.clauses) {
    if (!groups.has(clause.head.predicate)) groups.set(clause.head.predicate, [])
    groups.get(clause.head.predicate).push(clause)
  }
  const depsOf = pred => groups.get(pred).flatMap(c => c.body.map(g => g.predicate)).filter(p => heads.has(p))
  const order = topoOrder(heads, depsOf)
  if (!order) return infeasible("mutual recursion among head predicates is not expressible as a SQL recursive CTE")

  const stmts = []
  for (const pred of order) {
    const clauses = groups.get(pred)
    const arity = clauses[0].head.args.length
    const cols = Array.from({ length: arity }, (_, i) => `c${i}`).join(", ")
    const anchor = clauses.filter(c => !c.body.some(g => g.predicate === pred))
    const recursive = clauses.filter(c => c.body.some(g => g.predicate === pred))

    if (recursive.length === 0) {
      const union = clauses.map(c => emitSelect(c, p => p)).join("\n  UNION\n  ")
      stmts.push(`CREATE VIEW ${pred} AS\n  ${union}`)
    } else {
      if (anchor.length === 0) return infeasible(`${pred}: recursive predicate has no base case`)
      const cte = `${pred}_rec`
      const relationOf = p => (p === pred ? cte : p)
      const anchorSql = anchor.map(c => emitSelect(c, relationOf)).join("\n    UNION\n    ")
      const recSql = recursive.map(c => emitSelect(c, relationOf)).join("\n    UNION\n    ")
      stmts.push(`CREATE VIEW ${pred} AS\n  WITH RECURSIVE ${cte}(${cols}) AS (\n    ${anchorSql}\n    UNION\n    ${recSql}\n  )\n  SELECT ${cols} FROM ${cte}`)
    }
  }

  return {
    source: stmts.join(";\n\n") + ";\n",
    metadata: {
      target: "sql",
      feasibility: "ok",
      caveats: [],
      reason: null,
      imports: [],
      entrypoints: order
    }
  }
}
