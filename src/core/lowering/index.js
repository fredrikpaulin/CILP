// Lowering dispatch. Each target is a pure function `lower(program, harness, options)
// => { source, metadata }` in its own file; this picks one by `options.target`
// (default "javascript"). The JSON interpreter is the reference semantics every target
// is checked against, and the feasibility/mode analysis is shared in analyze.js.

import { lowerJavaScript } from "./javascript.js"
import { lowerPython } from "./python.js"
import { lowerSql } from "./sql.js"
import { lowerC } from "./c.js"

export { lowerJavaScript, lowerPython, lowerSql, lowerC }

// Lowered source is deterministic from a program, its options/harness, and the lowering
// code. This version stamps that code: bump it whenever a lowering's output changes, so a
// cache keyed on it (#033) never serves stale source from an older lowering.
export const LOWERING_VERSION = "2"

const targets = { javascript: lowerJavaScript, python: lowerPython, sql: lowerSql, c: lowerC }

export function lower(program, harness, options = {}) {
  const target = options.target ?? "javascript"
  const fn = targets[target]
  if (!fn) throw new Error(`no lowering for target "${target}"`)
  return fn(program, harness, options)
}
