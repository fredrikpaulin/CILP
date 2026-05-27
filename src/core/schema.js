// The term language: six structures, defined once as JSON Schema (draft 2020-12)
// and validated by a small generic validator driven by those schemas. Defining
// the shapes in one place and validating against them — rather than hand-writing
// predicate functions — keeps a single source of truth. The validator covers only
// the keywords these schemas use; it is not a general-purpose JSON Schema engine.

export const copperSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://copper-ilp.dev/schema/terms.json",
  $defs: {
    // A variable carries a symbolic name for readability. The integer id is added
    // by the normalization pass at executor entry (see ticket #005), so it is
    // optional here: authored programs use names, normalized programs also have ids.
    variable: {
      type: "object",
      properties: {
        type: { const: "var" },
        name: { type: "string", minLength: 1 },
        id: { type: "integer" }
      },
      required: ["type", "name"],
      additionalProperties: false
    },
    constant: {
      type: "object",
      properties: {
        type: { const: "const" },
        value: { type: ["string", "number", "boolean"] }
      },
      required: ["type", "value"],
      additionalProperties: false
    },
    compound: {
      type: "object",
      properties: {
        type: { const: "compound" },
        functor: { type: "string", minLength: 1 },
        args: { type: "array", items: { $ref: "#/$defs/term" } }
      },
      required: ["type", "functor", "args"],
      additionalProperties: false
    },
    term: {
      oneOf: [
        { $ref: "#/$defs/variable" },
        { $ref: "#/$defs/constant" },
        { $ref: "#/$defs/compound" }
      ]
    },
    atom: {
      type: "object",
      properties: {
        predicate: { type: "string", minLength: 1 },
        args: { type: "array", items: { $ref: "#/$defs/term" } }
      },
      required: ["predicate", "args"],
      additionalProperties: false
    },
    clause: {
      type: "object",
      properties: {
        head: { $ref: "#/$defs/atom" },
        body: { type: "array", items: { $ref: "#/$defs/atom" } }
      },
      required: ["head", "body"],
      additionalProperties: false
    },
    program: {
      type: "object",
      properties: {
        clauses: { type: "array", items: { $ref: "#/$defs/clause" } }
      },
      required: ["clauses"],
      additionalProperties: false
    },
    predicateDecl: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        arity: { type: "integer" },
        arg_types: { type: "array", items: { type: "string" } },
        mode: { type: "array", items: { enum: ["in", "out"] } }
      },
      required: ["name", "arity"],
      additionalProperties: false
    },
    // A canonical example call for a primitive. `result` is left unconstrained here:
    // its meaning (the expected solutions) is defined by the conformance suite (#024).
    manifestExample: {
      type: "object",
      properties: {
        call: { $ref: "#/$defs/atom" },
        result: {}
      },
      required: ["call"],
      additionalProperties: false
    },
    // A primitive declaration in a harness manifest. Richer than the bias's
    // predicateDecl: it carries the natural-language semantics, determinism, and
    // canonical example calls a manifest needs, and uses `modes` (one per argument).
    primitiveDecl: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        arity: { type: "integer" },
        arg_types: { type: "array", items: { type: "string" } },
        modes: { type: "array", items: { enum: ["in", "out"] } },
        description: { type: "string", minLength: 1 },
        determinism: { enum: ["det", "nondet"] },
        examples: { type: "array", items: { $ref: "#/$defs/manifestExample" } }
      },
      required: ["name", "arity", "description", "determinism"],
      additionalProperties: false
    },
    // A language-agnostic declaration of the primitives a program may call. The
    // semantic_hash is optional in the schema (a manifest can be authored before it
    // is stamped); harness.js fills and checks it.
    harnessManifest: {
      type: "object",
      properties: {
        library: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        primitives: { type: "array", items: { $ref: "#/$defs/primitiveDecl" } },
        semantic_hash: { type: "string" }
      },
      required: ["library", "version", "primitives"],
      additionalProperties: false
    },
    // A constant the enumerator may place in a clause body. `type` (optional) ties it to a
    // predicate argument type: a typed constant only goes in positions of its type. An
    // untyped constant may go anywhere. The pool is optional; without it the hypothesis
    // space stays variable-only.
    constantDecl: {
      type: "object",
      properties: { value: {}, type: { type: "string" } },
      required: ["value"],
      additionalProperties: false
    },
    bias: {
      type: "object",
      properties: {
        head_predicates: { type: "array", items: { $ref: "#/$defs/predicateDecl" } },
        body_predicates: { type: "array", items: { $ref: "#/$defs/predicateDecl" } },
        constants: { type: "array", items: { $ref: "#/$defs/constantDecl" } },
        max_clauses: { type: "integer" },
        max_body_length: { type: "integer" },
        max_variables: { type: "integer" },
        max_recursion_depth: { type: "integer" },
        allow_recursion: { type: "boolean" }
      },
      required: ["head_predicates", "body_predicates", "max_clauses", "max_body_length", "max_variables", "max_recursion_depth", "allow_recursion"],
      additionalProperties: false
    },
    problem: {
      type: "object",
      properties: {
        bias: { $ref: "#/$defs/bias" },
        background: { type: ["string", "object"] }, // module path, or in-process registry/predicates
        positives: { type: "array", items: { $ref: "#/$defs/atom" } },
        negatives: { type: "array", items: { $ref: "#/$defs/atom" } },
        max_candidates: { type: "integer" },
        max_time_ms: { type: "integer" },
        target_coverage: { type: "number" },
        noise_tolerance: { type: "integer" }
      },
      required: ["bias", "background", "positives", "negatives"],
      additionalProperties: false
    },
    packedTermLayout: {
      type: "object",
      properties: {
        $id: { type: "string" },
        kind: { const: "packed-term" },
        maxArity: { type: "integer" },
        maxDepth: { type: "integer" },
        intsPerSlot: { type: "integer" },
        slotsPerTerm: { type: "integer" },
        intsPerTerm: { type: "integer" }
      },
      required: ["$id", "kind", "maxArity", "maxDepth", "intsPerSlot", "slotsPerTerm", "intsPerTerm"],
      additionalProperties: false
    },
    packedClauseLayout: {
      type: "object",
      properties: {
        $id: { type: "string" },
        kind: { const: "packed-clause" },
        maxArity: { type: "integer" },
        maxBodyLength: { type: "integer" },
        atomsPerClause: { type: "integer" },
        intsPerSlot: { type: "integer" },
        intsPerAtom: { type: "integer" },
        intsPerClause: { type: "integer" }
      },
      required: ["$id", "kind", "maxArity", "maxBodyLength", "atomsPerClause", "intsPerSlot", "intsPerAtom", "intsPerClause"],
      additionalProperties: false
    },
    coverageMaskLayout: {
      type: "object",
      properties: {
        $id: { type: "string" },
        kind: { const: "coverage-mask" },
        candidates: { type: "integer" },
        examples: { type: "integer" },
        bytesPerEntry: { type: "integer" },
        byteLength: { type: "integer" }
      },
      required: ["$id", "kind", "candidates", "examples", "bytesPerEntry", "byteLength"],
      additionalProperties: false
    }
  }
}

function matchesType(value, t) {
  switch (t) {
    case "string": return typeof value === "string"
    case "number": return typeof value === "number"
    case "integer": return typeof value === "number" && Number.isInteger(value)
    case "boolean": return typeof value === "boolean"
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value)
    case "array": return Array.isArray(value)
    case "null": return value === null
    default: return false
  }
}

function describe(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function resolveRef(ref, root) {
  // Only local refs of the form "#/$defs/name" are used.
  const parts = ref.replace(/^#\//, "").split("/")
  let node = root
  for (const p of parts) node = node?.[p]
  if (!node) throw new Error(`cannot resolve $ref "${ref}"`)
  return node
}

function check(value, schema, root, path, errors) {
  if (schema.$ref) {
    check(value, resolveRef(schema.$ref, root), root, path, errors)
    return
  }
  if (schema.oneOf) {
    const matched = schema.oneOf.filter(s => isValid(value, s, root))
    if (matched.length !== 1) {
      errors.push(`${path}: expected exactly one of ${schema.oneOf.length} variants to match, ${matched.length} did`)
    }
    return
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected ${JSON.stringify(schema.const)}`)
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: expected one of ${JSON.stringify(schema.enum)}`)
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(t => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join("|")}, got ${describe(value)}`)
      return // a wrong base type makes the remaining checks meaningless
    }
  }
  if (schema.minLength !== undefined && typeof value === "string" && value.length < schema.minLength) {
    errors.push(`${path}: shorter than minLength ${schema.minLength}`)
  }
  if (matchesType(value, "object")) {
    if (schema.required) {
      for (const k of schema.required) if (!(k in value)) errors.push(`${path}: missing required "${k}"`)
    }
    if (schema.properties) {
      for (const [k, sub] of Object.entries(schema.properties)) {
        if (k in value) check(value[k], sub, root, `${path}/${k}`, errors)
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const k of Object.keys(value)) {
        if (!(k in schema.properties)) errors.push(`${path}: unexpected property "${k}"`)
      }
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((el, i) => check(el, schema.items, root, `${path}/${i}`, errors))
  }
}

function isValid(value, schema, root) {
  const errors = []
  check(value, schema, root, "#", errors)
  return errors.length === 0
}

// Validate a value against one of the named term-language schemas.
// Returns { valid, errors }.
export function validate(value, kind = "program") {
  const schema = copperSchema.$defs[kind]
  if (!schema) throw new Error(`unknown schema "${kind}"`)
  const errors = []
  check(value, schema, copperSchema, "#", errors)
  return { valid: errors.length === 0, errors }
}

export const isTerm = v => validate(v, "term").valid
export const isAtom = v => validate(v, "atom").valid
export const isClause = v => validate(v, "clause").valid
export const isProgram = v => validate(v, "program").valid
