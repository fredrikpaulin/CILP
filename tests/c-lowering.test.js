import { test, expect, afterAll } from "bun:test"
import { lowerC, verify, makeRegistry } from "../src/core/index.js"
import { predicates } from "../libraries/lists/1.0.0/javascript.js"
import last from "../applications/demo/problems/last.js"
import { resolve } from "node:path"
import { rmSync, cpSync } from "node:fs"

// Running emitted C needs a compiler; skip the compile-and-run tests where it's missing
// (the emission/feasibility tests below run regardless). Same gating as the GPU/Python tests.
const CC = Bun.which("cc") ? "cc" : Bun.which("gcc") ? "gcc" : null
const t = CC ? test : test.skip

const V = name => ({ type: "var", name })
const C = value => ({ type: "const", value })
const nil = { type: "compound", functor: "nil", args: [] }
const cons = (h, tl) => ({ type: "compound", functor: "cons", args: [h, tl] })
const list = (...xs) => xs.reduceRight((tail, x) => cons(C(x), tail), nil)
const atom = (predicate, ...args) => ({ predicate, args })
const clause = (head, ...body) => ({ head, body })

const tmp = resolve(import.meta.dir, ".c-tmp")
const runtimeH = resolve(import.meta.dir, "../src/core/lowering/copper.h")
const listsC = resolve(import.meta.dir, "../libraries/lists/1.0.0/c.c")
const manifest = await Bun.file(resolve(import.meta.dir, "../libraries/lists/1.0.0/manifest.json")).json()
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

// Build a C `main` that constructs each example's terms and checks the lowered function
// classifies it as the interpreter does (positives covered, negatives rejected).
function buildMain(entry, examples) {
  let n = 0
  const decls = []
  const build = term => {
    const v = `_t${n++}`
    if (term.type === "const") decls.push(`term ${v} = mk_atom(${JSON.stringify(String(term.value))});`)
    else if (term.functor === "nil") decls.push(`term ${v} = mk_nil();`)
    else { const h = build(term.args[0]), tl = build(term.args[1]); decls.push(`term ${v} = mk_cons(&${h}, &${tl});`) }
    return v
  }
  const checks = examples.map(({ atom, expect }) => {
    const ins = atom.args.slice(0, -1).map(build)
    const out = build(atom.args[atom.args.length - 1])
    return `  { term* o; bool h = ${entry}(${ins.map(i => `&${i}`).join(", ")}, &o); bool cov = h && term_eq(o, &${out}); if (cov != ${expect}) fails++; }`
  })
  return `#include "lowered.c"\n#include <stdio.h>\nint main(void) {\n  int fails = 0;\n${decls.map(d => "  " + d).join("\n")}\n${checks.join("\n")}\n  printf(fails ? "FAIL\\n" : "OK\\n");\n  return fails ? 1 : 0;\n}\n`
}

async function compileAndRun(program, modes, entry, examples) {
  rmSync(tmp, { recursive: true, force: true })
  const { source } = lowerC(program, manifest, { modes, implementation: "c.c" })
  await Bun.write(`${tmp}/lowered.c`, source)
  cpSync(runtimeH, `${tmp}/copper.h`)
  cpSync(listsC, `${tmp}/c.c`)
  await Bun.write(`${tmp}/main.c`, buildMain(entry, examples))
  const env = { ...process.env, TMPDIR: tmp } // keep gcc's temp files off the full volume
  const build = Bun.spawn([CC, "-std=c11", "-o", "run", "main.c"], { cwd: tmp, env, stdout: "pipe", stderr: "pipe" })
  await build.exited
  if (build.exitCode !== 0) throw new Error(`cc failed: ${await new Response(build.stderr).text()}`)
  const run = Bun.spawn([`${tmp}/run`], { cwd: tmp, stdout: "pipe" })
  await run.exited
  return { exitCode: run.exitCode, out: (await new Response(run.stdout).text()).trim() }
}

// second(L, X) :- tail(L, T), head(T, X).
const second = { clauses: [clause(atom("second", V("L"), V("X")), atom("tail", V("L"), V("T")), atom("head", V("T"), V("X")))] }
const secondExamples = [
  { atom: atom("second", list("a", "b"), C("b")), expect: "true" },
  { atom: atom("second", list("a", "b", "c"), C("b")), expect: "true" },
  { atom: atom("second", list("x", "y", "z"), C("y")), expect: "true" },
  { atom: atom("second", list("a", "b"), C("a")), expect: "false" },
  { atom: atom("second", list("a", "b", "c"), C("c")), expect: "false" },
  { atom: atom("second", list("a", "b", "c"), C("a")), expect: "false" }
]

t("emitted C for a deterministic chain compiles and classifies every example", async () => {
  // The reference also agrees, so "classifies correctly" means "matches the interpreter".
  expect(verify(second, makeRegistry(predicates), {
    positives: secondExamples.filter(e => e.expect === "true").map(e => e.atom),
    negatives: secondExamples.filter(e => e.expect === "false").map(e => e.atom)
  }).correct).toBe(true)

  const { exitCode, out } = await compileAndRun(second, { second: ["in", "out"] }, "second", secondExamples)
  expect(out).toBe("OK")
  expect(exitCode).toBe(0)
})

t("emitted C for a recursive, multi-clause program (last/2) compiles and classifies correctly", async () => {
  const examples = [
    ...last.problem.positives.map(a => ({ atom: a, expect: "true" })),
    ...last.problem.negatives.map(a => ({ atom: a, expect: "false" }))
  ]
  const { exitCode, out } = await compileAndRun(last.expected, { last: ["in", "out"] }, "last", examples)
  expect(out).toBe("OK")
  expect(exitCode).toBe(0)
})

// Emission and feasibility need no compiler — they always run.

test("a non-deterministic primitive is reported non-lowerable", () => {
  const prog = { clauses: [clause(atom("anyof", V("X"), V("L")), atom("member", V("X"), V("L")))] }
  const { source, metadata } = lowerC(prog, manifest, { modes: { anyof: ["out", "in"] } })
  expect(source).toBeNull()
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/deterministic/)
})

test("an unmoded predicate is reported non-lowerable", () => {
  const prog = { clauses: [clause(atom("second", V("L"), V("X")), atom("tail", V("L"), V("T")), atom("head", V("T"), V("X")))] }
  const { metadata } = lowerC(prog, { primitives: [] }, {}) // no modes anywhere
  expect(metadata.feasibility).toBe("infeasible")
  expect(metadata.reason).toMatch(/no mode declaration/)
})

test("recursion is reported as a caveat and the C is emitted", () => {
  const { source, metadata } = lowerC(last.expected, manifest, { modes: { last: ["in", "out"] } })
  expect(metadata.feasibility).toBe("caveats")
  expect(metadata.caveats[0]).toMatch(/recursive/)
  expect(metadata.target).toBe("c")
  expect(metadata.entrypoints).toEqual(["last"])
  expect(source).toContain("bool last(")
})
