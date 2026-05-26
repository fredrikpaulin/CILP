// Unification over the term language. The standard algorithm with occurs-check.
//
// A substitution maps variable ids to terms. It is *persistent*: binding returns a new
// substitution that shares structure with the old one, so a caller can keep the original
// around after a failed (or alternative) unification without the O(n) per-bind copy a
// plain Map would force. unify() returns a new substitution on success or null on failure
// and never mutates its input. Variables carry integer ids (the executor operates on
// normalized terms; see #005). A plain Map is still accepted as a seed — an empty initial
// substitution is the common one — and the first binding migrates it into the persistent
// form, so existing callers and tests that pass `new Map()` keep working. (#020)

const BITS = 5
const MASK = 31
const DEPTH = 7 // a fixed, immutable radix trie keyed on the 35-bit variable id

function trieGet(root, id) {
  let node = root
  for (let s = 0; s < DEPTH && node !== undefined; s++) node = node[(id >>> (s * BITS)) & MASK]
  return node
}

// Insert by path-copying: clone only the nodes along this id's path, sharing the rest with
// the old trie. O(DEPTH) — independent of how many bindings the substitution already holds.
function trieSet(root, id, term) {
  const path = []
  let node = root
  for (let s = 0; s < DEPTH; s++) {
    path.push(node)
    node = node === undefined ? undefined : node[(id >>> (s * BITS)) & MASK]
  }
  let child = term
  for (let s = DEPTH - 1; s >= 0; s--) {
    const copy = path[s] === undefined ? {} : { ...path[s] }
    copy[(id >>> (s * BITS)) & MASK] = child
    child = copy
  }
  return child
}

// A persistent substitution. `has`/`get` mirror a Map so walk/occurs/applySubstitution work
// over either a Sub or a Map seed; `set` returns a new Sub sharing structure with this one.
export class Sub {
  constructor(root = undefined, size = 0) {
    this.root = root
    this.size = size
  }
  has(id) { return trieGet(this.root, id) !== undefined }
  get(id) { return trieGet(this.root, id) }
  set(id, term) {
    const grew = trieGet(this.root, id) === undefined
    return new Sub(trieSet(this.root, id, term), grew ? this.size + 1 : this.size)
  }
  static from(seed) {
    if (seed instanceof Sub) return seed
    let s = EMPTY
    for (const [id, term] of seed) s = s.set(id, term) // a Map seed, usually empty
    return s
  }
}

const EMPTY = new Sub()

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
  return Sub.from(sub).set(variable.id, term)
}

export function unify(a, b, sub = EMPTY) {
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

// Structural equality of two terms. Used where unification can't enforce an equality
// constraint — e.g. a lowering comparing a value already produced against one a later
// call returns. On ground terms (the usual case) it is a plain deep compare.
export function termEqual(a, b) {
  if (a.type !== b.type) return false
  if (a.type === "var") return a.id === b.id
  if (a.type === "const") return a.value === b.value
  return a.functor === b.functor && a.args.length === b.args.length && a.args.every((x, i) => termEqual(x, b.args[i]))
}
