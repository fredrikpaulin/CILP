import { test, expect } from "bun:test"
import { libraryRegistry } from "../src/engine/registry.js"
import { interpret, walk } from "../src/core/index.js"

// Absolute roots, so the tests don't depend on the working directory.
const curated = `${import.meta.dir}/../libraries`
const fixtures = `${import.meta.dir}/fixtures/registry`

const C = value => ({ type: "const", value })
const V = (name, id) => ({ type: "var", name, id })
const nil = { type: "compound", functor: "nil", args: [] }
const cons = (h, t) => ({ type: "compound", functor: "cons", args: [h, t] })

test("list and versions enumerate the curated libraries", async () => {
  const reg = libraryRegistry(curated)
  expect(await reg.list()).toContainEqual({ library: "lists", version: "1.0.0" })
  expect(await reg.versions("lists")).toEqual(["1.0.0"])
})

test("'latest' resolves to the highest version", async () => {
  const reg = libraryRegistry(curated)
  expect(await reg.resolveVersion("lists", "latest")).toBe("1.0.0")
})

test("manifest loads and validates a (library, version)", async () => {
  const man = await libraryRegistry(curated).manifest("lists", "1.0.0")
  expect(man.library).toBe("lists")
  expect(man.primitives.map(p => p.name).sort()).toEqual(["cons", "empty", "head", "member", "tail"])
})

test("implementationSource returns code text without executing it", async () => {
  const src = await libraryRegistry(curated).implementationSource("lists", "1.0.0", "javascript")
  expect(src).toContain("export const predicates")
})

test("load resolves a triple into a verified, working registry", async () => {
  const { manifest, registry, version } = await libraryRegistry(curated).load("lists", "latest")
  expect(version).toBe("1.0.0")
  expect(manifest.library).toBe("lists")
  // member(X, [1,2]) through the loaded registry.
  const query = { predicate: "member", args: [V("X", 0), cons(C(1), cons(C(2), nil))] }
  const xs = [...interpret({ clauses: [] }, registry, query)].map(s => walk(V("X", 0), s).value).sort()
  expect(xs).toEqual([1, 2])
})

test("a stale implementation is rejected at load via the hash check", async () => {
  await expect(libraryRegistry(fixtures).load("stale", "1.0.0"))
    .rejects.toThrow(/implementation targets/)
})

test("an HTTP root can read but not load", async () => {
  const remote = libraryRegistry("https://example.com/libraries")
  await expect(remote.load("lists", "1.0.0")).rejects.toThrow(/requires a local registry/)
  await expect(remote.list()).rejects.toThrow(/requires a local registry root/)
})

test("a missing library or version throws", async () => {
  const reg = libraryRegistry(curated)
  await expect(reg.manifest("nope", "1.0.0")).rejects.toThrow()
  await expect(reg.manifest("lists", "9.9.9")).rejects.toThrow()
})
