// Variables are symbolic in authored programs (a `name`) and integer-keyed inside
// the executor (an `id`). normalize() assigns the ids; denormalize() strips them
// back to authored form. Names are preserved throughout, so the round-trip is
// exact.
//
// Variables are scoped per clause: the same name in two clauses is two different
// variables, so each clause is normalized independently, with ids assigned in
// first-appearance order from 0. This keeps per-clause ids bounded by the bias's
// max_variables and matches how the interpreter standardizes clauses apart.

function assignTerm(t, nameToId, names) {
  if (t.type === "var") {
    if (!nameToId.has(t.name)) {
      const id = nameToId.size
      nameToId.set(t.name, id)
      names.set(id, t.name)
    }
    return { type: "var", name: t.name, id: nameToId.get(t.name) }
  }
  if (t.type === "compound") return { ...t, args: t.args.map(a => assignTerm(a, nameToId, names)) }
  return t
}

function assignAtom(a, nameToId, names) {
  return { ...a, args: a.args.map(t => assignTerm(t, nameToId, names)) }
}

function normalizeClause(clause) {
  const nameToId = new Map()
  const names = new Map()
  const head = assignAtom(clause.head, nameToId, names)
  const body = clause.body.map(a => assignAtom(a, nameToId, names))
  return { value: { head, body }, names }
}

// Assign integer ids to the variables of a term-language node. Returns
// { value, names }: the node with ids, and the id→name map for its scope. For a
// Program, `names` is an array of maps, one per clause.
export function normalize(node) {
  if (node.clauses) {
    const value = []
    const names = []
    for (const clause of node.clauses) {
      const r = normalizeClause(clause)
      value.push(r.value)
      names.push(r.names)
    }
    return { value: { ...node, clauses: value }, names }
  }
  if (node.head) return normalizeClause(node)
  const nameToId = new Map()
  const names = new Map()
  if (node.predicate) return { value: assignAtom(node, nameToId, names), names }
  return { value: assignTerm(node, nameToId, names), names }
}

function stripTerm(t) {
  if (t.type === "var") return { type: "var", name: t.name }
  if (t.type === "compound") return { ...t, args: t.args.map(stripTerm) }
  return t
}

function stripAtom(a) {
  return { ...a, args: a.args.map(stripTerm) }
}

// Strip ids from a node, restoring authored (name-only) form.
export function denormalize(node) {
  if (node.clauses) return { ...node, clauses: node.clauses.map(denormalize) }
  if (node.head) return { head: stripAtom(node.head), body: node.body.map(stripAtom) }
  if (node.predicate) return stripAtom(node)
  return stripTerm(node)
}
