// Harness manifests: the language-agnostic contract for a library of primitives.
// A manifest declares *what* primitives exist and what they mean — name, arity, arg
// types, modes, determinism, a natural-language description, and canonical example
// calls — not *how* they are implemented. The same manifest is consumed by the
// interpreter and by every lowering (#026+). A `semantic_hash` over the declarations
// lets an implementation detect at load time that it was built against a different
// version of the manifest, before a stale implementation miscompiles silently.
//
// This supersedes the informal "JS functions registered by name": a registry is now
// the verified pairing of a manifest with an implementation that targets its hash.

import { validate } from "./schema.js"
import { makeRegistry } from "./background.js"

// Recursively sort object keys so equal content serializes identically regardless of
// how it was constructed. Arrays keep their order (the caller sorts where order is
// not semantic).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k])
    return out
  }
  return value
}

// Web Crypto is global in Bun, Node 18+, browsers, and Workers — so this stays in
// copper-core without a native or node: dependency.
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")
}

// Cross-checks the schema can't express: arity must agree with arg_types and modes,
// every example call must name its primitive and match its arity, and primitive
// names must be unique.
function structuralErrors(manifest) {
  const errors = []
  const seen = new Set()
  for (const p of manifest.primitives ?? []) {
    if (seen.has(p.name)) errors.push(`duplicate primitive "${p.name}"`)
    seen.add(p.name)
    if (p.arg_types && p.arg_types.length !== p.arity)
      errors.push(`${p.name}: arg_types has ${p.arg_types.length} entries, arity is ${p.arity}`)
    if (p.modes && p.modes.length !== p.arity)
      errors.push(`${p.name}: modes has ${p.modes.length} entries, arity is ${p.arity}`)
    for (const ex of p.examples ?? []) {
      if (ex.call.predicate !== p.name)
        errors.push(`${p.name}: example call names "${ex.call.predicate}"`)
      if (ex.call.args.length !== p.arity)
        errors.push(`${p.name}: example call has ${ex.call.args.length} args, arity is ${p.arity}`)
    }
  }
  return errors
}

// Schema + structural validation. Does not check the semantic hash — see verifyManifest.
export function validateManifest(manifest) {
  const schema = validate(manifest, "harnessManifest")
  const errors = schema.valid ? structuralErrors(manifest) : schema.errors
  return { valid: errors.length === 0, errors }
}

// Parse (if given JSON text) and validate a manifest. Throws on invalid input.
export function loadManifest(source) {
  const manifest = typeof source === "string" ? JSON.parse(source) : source
  const { valid, errors } = validateManifest(manifest)
  if (!valid) throw new Error(`invalid manifest: ${errors.join("; ")}`)
  return manifest
}

// The semantic hash: sha256 over the canonical primitive declarations, independent of
// primitive order and key order. It excludes library/version (identity labels, not
// semantics) and the stored hash itself, so two manifests with identical primitives
// hash alike whatever they are versioned as — that is what makes an implementation
// safe to reuse across a no-op version bump.
export async function semanticHash(manifest) {
  const prims = (manifest.primitives ?? []).map(canonical)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return "sha256:" + await sha256Hex(JSON.stringify(prims))
}

// A copy of the manifest with its semantic_hash filled in. For authoring.
export async function withHash(manifest) {
  return { ...manifest, semantic_hash: await semanticHash(manifest) }
}

// Full check: structure valid AND, when a semantic_hash is recorded, it matches the
// computed one — catching a manifest edited without re-stamping its hash.
export async function verifyManifest(manifest) {
  const base = validateManifest(manifest)
  if (!base.valid || manifest.semantic_hash === undefined) return base
  const expected = await semanticHash(manifest)
  if (manifest.semantic_hash !== expected)
    return { valid: false, errors: [`semantic_hash ${manifest.semantic_hash} does not match computed ${expected}`] }
  return { valid: true, errors: [] }
}

// Verify an implementation was built against this manifest. The implementation records
// the manifest hash it targets in `semantic_hash`. Throws on mismatch.
export async function checkImplementation(implementation, manifest) {
  const expected = await semanticHash(manifest)
  const recorded = implementation.semantic_hash
  if (recorded !== expected)
    throw new Error(`implementation targets ${recorded ?? "(none)"}, manifest semantic_hash is ${expected}`)
  return true
}

// Build a background registry from an implementation, after verifying it targets this
// manifest. This is the seam where a manifest reaches the interpreter (#004): a
// registry is a manifest and a hash-checked implementation, not a bare bag of functions.
export async function loadHarness(manifest, implementation) {
  await checkImplementation(implementation, manifest)
  return makeRegistry(implementation.predicates)
}
