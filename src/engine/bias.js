// LLM-assisted bias synthesis (C3). The classic pain of ILP is hand-crafting the
// bias — which predicates the search may use, and how big a program to allow. This is
// a fuzzy, contextual judgment, exactly what an LLM is good at; the rigorous search
// inside the bias is exactly what the LLM is bad at and Copper is good at. So the LLM
// scopes the search and Copper performs it. The LLM never writes the program.
//
// The model is injected as `callModel(prompt) => Promise<string>`, so this module has
// no LLM dependency: tests pass a mock, production passes a real model. What lives
// here and is fully tested is the contract around the model — building the prompt,
// parsing the response, and (critically) validating the proposed bias before it's
// allowed anywhere near the search.

import { validate } from "../core/schema.js"

export function validateBias(bias) {
  return validate(bias, "bias")
}

// Build the prompt shown to the model: the task, the predicate catalog it may choose
// from, and the exact JSON shape to return.
export function buildBiasPrompt({ description, examples, catalog, headHint }) {
  const preds = catalog.map(p => `- ${p.name}/${p.arity}: ${p.description}`).join("\n")
  return [
    "You are scoping a search for an Inductive Logic Programming system (Copper).",
    "Given a task and a catalog of background predicates, choose a bias: which predicates",
    "the search may use in clause bodies, and the size bounds. Pick the SMALLEST set of",
    "predicates and the tightest bounds that could still express the rule — a tighter bias",
    "is what makes the search tractable. You are not writing the program, only scoping it.",
    "",
    `Task: ${description}`,
    examples ? `\nExamples:\n${examples}` : "",
    headHint ? `\nThe target (head) predicate is ${headHint}.` : "",
    "",
    "Available background predicates:",
    preds,
    "",
    "Respond with only a JSON bias object of this shape:",
    '{ "head_predicates": [{ "name": "...", "arity": N }],',
    '  "body_predicates": [{ "name": "...", "arity": N }, ...],',
    '  "max_clauses": N, "max_body_length": N, "max_variables": N,',
    '  "max_recursion_depth": N, "allow_recursion": false }'
  ].join("\n")
}

// Extract a JSON bias from the model's reply — it may be fenced in ```json, or raw,
// or wrapped in prose. Throws if no parseable object is found.
export function parseBiasResponse(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fence ? fence[1] : text).trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  const json = start >= 0 && end > start ? body.slice(start, end + 1) : body
  return JSON.parse(json)
}

// Returns an async proposer: (description, examples) => validated bias. The proposer
// refuses to return a bias that doesn't validate against the schema, so a malformed
// model response fails loudly here rather than corrupting the search.
export function llmBiasProposer({ callModel, catalog, headHint }) {
  return async (description, examples) => {
    const prompt = buildBiasPrompt({ description, examples, catalog, headHint })
    const bias = parseBiasResponse(await callModel(prompt))
    const result = validateBias(bias)
    if (!result.valid) throw new Error(`proposed bias is invalid: ${result.errors.join("; ")}`)
    return bias
  }
}
