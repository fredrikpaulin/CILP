import { test, expect } from "bun:test"
import { conform, loadHarness, unify } from "../src/core/index.js"
import manifest from "../libraries/lists/1.0.0/manifest.json"
import * as listsImpl from "../libraries/lists/1.0.0/javascript.js"

const C = value => ({ type: "const", value })

test("the curated lists implementation conforms to its manifest", () => {
  const { conforms, results, untested } = conform(manifest, listsImpl)
  expect(conforms).toBe(true)
  expect(untested).toEqual([])
  // det output bindings, a nondet enumeration, and a det test (both true and false).
  expect(results.length).toBe(6) // cons, head, tail, empty×2, member
  expect(results.every(r => r.conforms)).toBe(true)
})

test("a wrong answer fails conformance for exactly that primitive", () => {
  // head that binds the output to 99 instead of the real head.
  const broken = {
    predicates: { ...listsImpl.predicates, head: (args, sub) => unify(args[1], C(99), sub) || false }
  }
  const { conforms, results } = conform(manifest, broken)
  expect(conforms).toBe(false)
  expect(results.find(r => r.primitive === "head").conforms).toBe(false)
  // everything else still agrees
  expect(results.filter(r => r.primitive !== "head").every(r => r.conforms)).toBe(true)
})

test("a missing implementation is reported as an error, not a crash", () => {
  const { member, ...rest } = listsImpl.predicates
  const { conforms, results } = conform(manifest, { predicates: rest })
  const memberResult = results.find(r => r.primitive === "member")
  expect(memberResult.conforms).toBe(false)
  expect(memberResult.error).toMatch(/no background predicate/)
  expect(conforms).toBe(false)
})

test("primitives with no examples are surfaced as untested, not passed", () => {
  const thin = {
    library: "thin", version: "1.0.0",
    primitives: [{ name: "foo", arity: 1, description: "untested primitive", determinism: "det" }]
  }
  const { conforms, results, untested } = conform(thin, { predicates: {} })
  expect(results).toEqual([])     // nothing exercised
  expect(conforms).toBe(true)     // vacuously — but...
  expect(untested).toEqual(["foo"]) // ...the manifest is honestly flagged as untested
})

test("conform is hash-agnostic — it checks behaviour, not identity", () => {
  // No semantic_hash on this object; conform only reads `predicates`.
  expect(conform(manifest, { predicates: listsImpl.predicates }).conforms).toBe(true)
})

test("a verified harness is both hash-checked and behaviour-checked", async () => {
  // loadHarness verifies the recorded hash (identity); conform verifies the example
  // calls (behaviour). Together they are the full trust check.
  const registry = await loadHarness(manifest, listsImpl)
  expect(registry.has("member")).toBe(true)
  expect(conform(manifest, listsImpl).conforms).toBe(true)
})
