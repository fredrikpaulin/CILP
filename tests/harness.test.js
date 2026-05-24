import { test, expect } from "bun:test"
import {
  validateManifest, loadManifest, semanticHash, withHash,
  verifyManifest, loadHarness
} from "../src/core/index.js"
import { interpret } from "../src/core/resolve.js"
import { walk } from "../src/core/unify.js"
import manifest from "./fixtures/kinship-manifest.json"
import { predicates } from "./fixtures/kinship-impl.js"

const V = (name, id) => ({ type: "var", name, id })
const C = value => ({ type: "const", value })
const atom = (predicate, ...args) => ({ predicate, args })

test("a well-formed manifest validates", () => {
  expect(validateManifest(manifest).valid).toBe(true)
})

test("validation catches arity, example, and uniqueness mismatches the schema can't", () => {
  const badTypes = structuredClone(manifest)
  badTypes.primitives[0].arg_types = ["person"] // arity 2, one type
  expect(validateManifest(badTypes).valid).toBe(false)

  const badExample = structuredClone(manifest)
  badExample.primitives[0].examples[0].call.args = [C("tom")] // arity 2, one arg
  expect(validateManifest(badExample).valid).toBe(false)

  const wrongName = structuredClone(manifest)
  wrongName.primitives[0].examples[0].call.predicate = "ancestor"
  expect(validateManifest(wrongName).valid).toBe(false)

  const dup = structuredClone(manifest)
  dup.primitives.push(structuredClone(dup.primitives[0]))
  expect(validateManifest(dup).valid).toBe(false)
})

test("loadManifest parses JSON text and throws on invalid input", () => {
  expect(loadManifest(JSON.stringify(manifest)).library).toBe("kinship")
  expect(() => loadManifest('{"library":"x","version":"1"}')).toThrow(/invalid manifest/)
})

test("the semantic hash is well-formed, deterministic, and order-independent", async () => {
  const h1 = await semanticHash(manifest)
  expect(h1).toMatch(/^sha256:[0-9a-f]{64}$/)
  expect(await semanticHash(manifest)).toBe(h1) // stable across calls

  // Reorder primitives and shuffle top-level keys: the hash must not move.
  const shuffled = {
    version: manifest.version,
    primitives: [manifest.primitives[1], manifest.primitives[0]],
    library: manifest.library
  }
  expect(await semanticHash(shuffled)).toBe(h1)
})

test("changing a declaration changes the hash", async () => {
  const before = await semanticHash(manifest)
  const changed = structuredClone(manifest)
  changed.primitives[0].determinism = "det" // was nondet
  expect(await semanticHash(changed)).not.toBe(before)
})

test("verifyManifest accepts a correct stored hash and rejects a stale one", async () => {
  const stamped = await withHash(manifest)
  expect((await verifyManifest(stamped)).valid).toBe(true)

  const stale = { ...stamped, semantic_hash: "sha256:deadbeef" }
  const result = await verifyManifest(stale)
  expect(result.valid).toBe(false)
  expect(result.errors[0]).toMatch(/does not match/)
})

test("loadHarness verifies the implementation hash, then yields a working registry", async () => {
  const hash = await semanticHash(manifest)
  const registry = await loadHarness(manifest, { semantic_hash: hash, predicates })

  // grandparent(X, Z) :- parent(X, Y), parent(Y, Z) against the verified harness.
  const program = { clauses: [{
    head: atom("grandparent", V("X", 0), V("Z", 1)),
    body: [atom("parent", V("X", 0), V("Y", 2)), atom("parent", V("Y", 2), V("Z", 1))]
  }] }
  const sols = [...interpret(program, registry, atom("grandparent", C("tom"), V("Z", 9)))]
    .map(s => walk(V("Z", 9), s).value).sort()
  expect(sols).toEqual(["ann", "pat"])
})

test("a stale or unstamped implementation is rejected at load", async () => {
  await expect(loadHarness(manifest, { semantic_hash: "sha256:0000", predicates }))
    .rejects.toThrow(/implementation targets/)
  await expect(loadHarness(manifest, { predicates }))
    .rejects.toThrow(/implementation targets \(none\)/)
})
