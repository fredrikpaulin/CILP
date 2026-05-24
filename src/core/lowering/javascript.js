// JavaScript lowering. A lowering is a pure function from a JSON program to
// target-language source. The JSON interpreter (resolve.js) is the reference
// semantics: lowered code must produce the same solutions on the same inputs, and a
// discrepancy is a lowering bug, not a synthesis bug.
//
// Modes do the work. A goal `p(X, Y)` with modes [in, out] becomes "X is already a JS
// binding; bind Y from p's solutions" — the head/clause unification and the
// substitution threading the interpreter does at runtime are compiled into native
// control flow at lowering time. Each head predicate lowers to a generator yielding
// its `out` arguments (as terms), one yield per solution, so a nondet primitive is
// just a loop and a det one is a loop that runs at most once.
//
// What this lowering does *not* do: invent a depth bound for recursion (it emits
// native recursive generator calls and relies on the data being well-founded), or
// handle compound or unmoded arguments. Those are reported, not faked — see the
// feasibility report in the returned metadata.

// name -> modes, from the harness primitives plus any head/target modes the caller
// supplies in options.modes (the target predicate's modes come from the bias, which
// the engine merges in here).
function modeMap(harness, options) {
  const map = new Map()
  for (const p of harness?.primitives ?? []) if (p.modes) map.set(p.name, p.modes)
  for (const [name, modes] of Object.entries(options.modes ?? {})) map.set(name, modes)
  return map
}

const headPredicates = program => new Set(program.clauses.map(c => c.head.predicate))
const hasCompoundArg = atom => atom.args.some(a => a.type === "compound")
const jsVar = name => `v_${name}`
const jsGen = name => `lowered_${name}`

// Render an in-position term as a JS expression: a variable resolves to its JS binding,
// a constant to a term literal. (Compound args are rejected before we get here.)
const renderTerm = term => (term.type === "var" ? jsVar(term.name) : JSON.stringify({ type: "const", value: term.value }))

// Check a clause is well-moded and within the supported subset. Returns a reason string
// if it cannot be lowered, or null if it can.
function modeError(clause, modes) {
  const head = clause.head.predicate
  if (hasCompoundArg(clause.head) || clause.body.some(hasCompoundArg))
    return `${head}: compound arguments are not supported by the JavaScript lowering`
  if (clause.head.args.some(a => a.type !== "var"))
    return `${head}: non-variable head arguments are not supported by the JavaScript lowering`

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

// Emit one clause as a brace-scoped block: head in-args alias the positional params,
// body goals nest as loops, the base yields the head's out-args.
function emitClause(clause, modes, heads, indent) {
  const hm = modes.get(clause.head.predicate)
  const ids = new Map()
  const varId = name => { if (!ids.has(name)) ids.set(name, ids.size); return ids.get(name) }
  clause.head.args.forEach(a => varId(a.name)) // stable first-appearance ids

  const lines = []
  const bound = new Set()
  clause.head.args.forEach((a, i) => {
    if (hm[i] === "in") { lines.push(`${indent}const ${jsVar(a.name)} = _in${i}`); bound.add(a.name) }
  })

  clause.body.forEach((goal, depth) => {
    const ind = indent + "  ".repeat(depth)
    const m = modes.get(goal.predicate)
    if (heads.has(goal.predicate)) {
      const inArgs = goal.args.filter((_, i) => m[i] === "in").map(renderTerm).join(", ")
      const tuple = `_t${depth}`
      lines.push(`${ind}for (const ${tuple} of ${jsGen(goal.predicate)}(${inArgs})) {`)
      let oi = 0
      goal.args.forEach((a, i) => {
        if (m[i] === "out" && a.type === "var") { lines.push(`${ind}  const ${jsVar(a.name)} = ${tuple}[${oi++}]`); bound.add(a.name) }
      })
    } else {
      const reads = []
      const args = goal.args.map((a, i) => {
        if (m[i] === "out" && a.type === "var" && !bound.has(a.name)) {
          const lit = `{ type: "var", name: ${JSON.stringify(a.name)}, id: ${varId(a.name)} }`
          reads.push({ js: jsVar(a.name), lit })
          bound.add(a.name)
          return lit
        }
        return renderTerm(a)
      })
      const s = `_s${depth}`
      lines.push(`${ind}for (const ${s} of _solve(${JSON.stringify(goal.predicate)}, [${args.join(", ")}])) {`)
      for (const r of reads) lines.push(`${ind}  const ${r.js} = applySubstitution(${r.lit}, ${s})`)
    }
  })

  const outs = clause.head.args.filter((_, i) => hm[i] === "out").map(a => jsVar(a.name))
  lines.push(`${indent}${"  ".repeat(clause.body.length)}yield [${outs.join(", ")}]`)
  for (let d = clause.body.length - 1; d >= 0; d--) lines.push(indent + "  ".repeat(d) + "}")
  return `${indent.slice(2)}{\n${lines.join("\n")}\n${indent.slice(2)}}`
}

const recursionCaveat = pred =>
  `${pred} is recursive; lowered as native recursion with no depth bound — relies on the data being well-founded`

export function lowerJavaScript(program, harness, options = {}) {
  const modes = modeMap(harness, options)
  const heads = headPredicates(program)
  const core = options.core ?? "copper-ilp/core"
  const implementation = options.implementation ?? "./javascript.js"

  for (const clause of program.clauses) {
    const reason = modeError(clause, modes)
    if (reason)
      return { source: null, metadata: { target: "javascript", feasibility: "infeasible", caveats: [], reason, imports: [], entrypoints: [] } }
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

  const blocks = []
  for (const [pred, clauses] of groups) {
    const hm = modes.get(pred)
    const params = clauses[0].head.args.map((_, i) => (hm[i] === "in" ? `_in${i}` : null)).filter(Boolean)
    const body = clauses.map(c => emitClause(c, modes, heads, "    ")).join("\n")
    blocks.push(`export function* ${jsGen(pred)}(${params.join(", ")}) {\n${body}\n}`)
  }

  const source = [
    "// Generated by the copper-ilp JavaScript lowering. Do not edit by hand.",
    "// Reference semantics: the JSON interpreter. This code must match it.",
    `import { makeRegistry, applySubstitution } from ${JSON.stringify(core)}`,
    `import { predicates } from ${JSON.stringify(implementation)}`,
    "",
    "const _reg = makeRegistry(predicates)",
    "const _solve = (name, args) => _reg.solve(name, args, new Map())",
    "",
    ...blocks
  ].join("\n") + "\n"

  return {
    source,
    metadata: {
      target: "javascript",
      feasibility: caveats.length ? "caveats" : "ok",
      caveats,
      reason: null,
      imports: [core, implementation],
      entrypoints: [...groups.keys()].map(jsGen)
    }
  }
}
