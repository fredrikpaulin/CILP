// Pretty-printing for the demo: terms (with cons/nil rendered as [a, b, c]), atoms,
// clauses (Prolog-style), and a compact proof trace from a verification result.

export function termText(t) {
  if (t.type === "var") return t.name
  if (t.type === "const") return String(t.value)
  if (t.type === "compound") {
    if (t.functor === "nil" && t.args.length === 0) return "[]"
    if (t.functor === "cons" && t.args.length === 2) {
      const items = []
      let cur = t
      while (cur.type === "compound" && cur.functor === "cons" && cur.args.length === 2) {
        items.push(termText(cur.args[0]))
        cur = cur.args[1]
      }
      const tail = cur.type === "compound" && cur.functor === "nil" ? "" : ` | ${termText(cur)}`
      return `[${items.join(", ")}${tail}]`
    }
    return `${t.functor}(${t.args.map(termText).join(", ")})`
  }
  return String(t)
}

export const atomText = a => `${a.predicate}(${a.args.map(termText).join(", ")})`

export const clauseText = c =>
  c.body.length ? `${atomText(c.head)} :- ${c.body.map(atomText).join(", ")}.` : `${atomText(c.head)}.`

export const programText = p => p.clauses.map(clauseText).join("\n")

// The witnessing background facts along the first derivation, or "rejected" if none.
export function traceText(proof) {
  if (!proof) return "rejected (no derivation)"
  const facts = proof.filter(e => e.via === "background").map(e => atomText(e.goal))
  return facts.length ? facts.join(", ") : "holds"
}
