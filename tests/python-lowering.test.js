import { test, expect, afterAll } from "bun:test"
import { lowerJavaScript, lowerPython, interpret, walk, makeRegistry, normalize } from "../src/core/index.js"
import { predicates as listsJS } from "../libraries/lists/1.0.0/javascript.js"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { rmSync } from "node:fs"

// Running the emitted Python needs an interpreter. Where it's missing, skip the execution
// tests (the emission/feasibility tests below run regardless) — the same gating the
// Apple-Silicon GPU tests use.
const hasPython = !!Bun.which("python3")
const t = hasPython ? test : test.skip

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const nil = { type: "compound", functor: "nil", args: [] }
const cons = (h, tl) => ({ type: "compound", functor: "cons", args: [h, tl] })
const clause = (head, ...body) => ({ head, body })
const atom = (predicate, ...args) => ({ predicate, args })

const tmp = resolve(import.meta.dir, ".py-tmp")
const runtimeDir = resolve(import.meta.dir, "../src/core/lowering")
const libDir = resolve(import.meta.dir, "../libraries/lists/1.0.0")
const driver = resolve(import.meta.dir, "fixtures/py_driver.py")
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const manifest = await Bun.file(resolve(libDir, "manifest.json")).json()

async function runDriver(spec) {
  const id = Math.random().toString(36).slice(2)
  const specPath = `${tmp}/spec_${id}.json`
  await Bun.write(specPath, JSON.stringify(spec))
  const proc = Bun.spawn(["python3", driver, specPath], {
    env: { ...process.env, PYTHONPATH: [tmp, runtimeDir, libDir].join(":") },
    stdout: "pipe", stderr: "pipe"
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  await proc.exited
  if (proc.exitCode !== 0) throw new Error(`python failed: ${err}`)
  return JSON.parse(out.trim())
}

// Lower a program to Python, write the module, run an entrypoint over input terms.
async function pythonRun(program, options, entry, ...args) {
  const { source } = lowerPython(program, manifest, { ...options, implementation: "python" })
  const module = `lowered_${Math.random().toString(36).slice(2)}`
  await Bun.write(`${tmp}/${module}.py`, source)
  return runDriver({ mode: "run", module, entry, args }) // [[outTerm, ...], ...]
}

// Lower the same program to JavaScript and run it, for cross-target comparison.
async function jsRun(program, options, entry, ...args) {
  const { source } = lowerJavaScript(program, manifest, { ...options, implementation: resolve(libDir, "javascript.js") })
  const path = `${tmp}/lowered_${Math.random().toString(36).slice(2)}.js`
  await Bun.write(path, source)
  const mod = await import(pathToFileURL(path).href)
  return [...mod[entry](...args)]
}

const interpreted = (program, query, outVar) =>
  [...interpret(normalize(program).value, makeRegistry(listsJS), query)].map(s => walk(outVar, s).value)

// second(L, X) :- tail(L, T), head(T, X).
const second = { clauses: [clause(atom("second", V("L"), V("X")), atom("tail", V("L"), V("T")), atom("head", V("T"), V("X")))] }
// elem(L, X) :- member(X, L).  member is non-deterministic.
const elem = { clauses: [clause(atom("elem", V("L"), V("X")), atom("member", V("X"), V("L")))] }

t("Python lowering matches the interpreter on a deterministic chain", async () => {
  const list = cons(C(10), cons(C(20), cons(C(30), nil)))
  const lowered = (await pythonRun(second, { modes: { second: ["in", "out"] } }, "lowered_second", list)).map(row => row[0].value)
  const interp = interpreted(second, atom("second", list, V("X")), V("X"))
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual([20])
})

t("Python lowering matches the interpreter on a non-deterministic predicate", async () => {
  const list = cons(C(1), cons(C(2), cons(C(3), nil)))
  const lowered = (await pythonRun(elem, { modes: { elem: ["in", "out"] } }, "lowered_elem", list)).map(row => row[0].value).sort()
  const interp = interpreted(elem, atom("elem", list, V("X")), V("X")).sort()
  expect(lowered).toEqual(interp)
  expect(lowered).toEqual([1, 2, 3])
})

t("the lists Python implementation passes its manifest example calls", async () => {
  const result = await runDriver({ mode: "conform", impl: "python", manifest: resolve(libDir, "manifest.json") })
  expect(result.conforms).toBe(true)
  expect(result.untested).toEqual([])
})

t("cross-target: the JavaScript and Python lowerings agree on the same program", async () => {
  const list = cons(C(1), cons(C(2), cons(C(3), nil)))
  const js = (await jsRun(elem, { modes: { elem: ["in", "out"] } }, "lowered_elem", list)).map(row => row[0].value).sort()
  const py = (await pythonRun(elem, { modes: { elem: ["in", "out"] } }, "lowered_elem", list)).map(row => row[0].value).sort()
  expect(py).toEqual(js)
})

// Emission and feasibility need no interpreter — they always run.

test("Python lowering reports an unmoded predicate as non-lowerable", () => {
  const prog = { clauses: [clause(atom("p", V("X"), V("Y")), atom("mystery", V("X"), V("Y")))] }
  const { source, metadata } = lowerPython(prog, { primitives: [] }, { modes: { p: ["in", "out"] } })
  expect(source).toBeNull()
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/no mode declaration/)
})

test("Python lowering reports recursion as a caveat", () => {
  const harness = { primitives: [{ name: "edge", arity: 2, modes: ["in", "out"], description: "edge", determinism: "nondet" }] }
  const path = {
    clauses: [
      clause(atom("path", V("X"), V("Y")), atom("edge", V("X"), V("Y"))),
      clause(atom("path", V("X"), V("Y")), atom("edge", V("X"), V("Z")), atom("path", V("Z"), V("Y")))
    ]
  }
  const { metadata } = lowerPython(path, harness, { modes: { path: ["in", "out"] } })
  expect(metadata.feasibility).toBe("caveats")
  expect(metadata.caveats[0]).toMatch(/recursive/)
})

test("Python metadata reports target, imports, and entrypoints", () => {
  const { metadata } = lowerPython(second, manifest, { modes: { second: ["in", "out"] }, implementation: "lists_impl", runtime: "copper_runtime" })
  expect(metadata.target).toBe("python")
  expect(metadata.imports).toEqual(["copper_runtime", "lists_impl"])
  expect(metadata.entrypoints).toEqual(["lowered_second"])
})
