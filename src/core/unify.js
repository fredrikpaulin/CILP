// Unification over the term language. The standard algorithm with occurs-check.
//
// A substitution is a Map<number, Term> keyed by variable id. unify() returns a
// new substitution on success or null on failure — it never mutates the input, so
// a caller can keep the original around after a failed attempt. Variables must
// carry integer ids (the executor operates on normalized terms; see ticket #005).

// Follow a variable through the substitution chain to whatever it is bound to.
// Returns the input term unchanged if it is not a bound variable.
export function walk(term, sub) {
  while (term.type === "var" && sub.has(term.id)) term = sub.get(term.id)
  return term
}

function occurs(id, term, sub) {
  term = walk(term, sub)
  if (term.type === "var") return term.id === id
  if (term.type === "compound") return term.args.some(a => occurs(id, a, sub))
  return false
}

function bind(variable, term, sub) {
  if (occurs(variable.id, term, sub)) return null // would build an infinite term
  const next = new Map(sub)
  next.set(variable.id, term)
  return next
}

export function unify(a, b, sub = new Map()) {
  a = walk(a, sub)
  b = walk(b, sub)

  if (a.type === "var" && b.type === "var" && a.id === b.id) return sub
  if (a.type === "var") return bind(a, b, sub)
  if (b.type === "var") return bind(b, a, sub)

  if (a.type === "const" && b.type === "const") {
    return a.value === b.value ? sub : null
  }

  if (a.type === "compound" && b.type === "compound") {
    if (a.functor !== b.functor || a.args.length !== b.args.length) return null
    for (let i = 0; i < a.args.length; i++) {
      sub = unify(a.args[i], b.args[i], sub)
      if (sub === null) return null
    }
    return sub
  }

  return null // mismatched kinds (var handled above; const vs compound, etc.)
}

// Resolve a term fully against a substitution, replacing bound variables all the
// way down. Used to materialize a result term for output.
export function applySubstitution(term, sub) {
  term = walk(term, sub)
  if (term.type === "compound") {
    return { ...term, args: term.args.map(a => applySubstitution(a, sub)) }
  }
  return term
}
