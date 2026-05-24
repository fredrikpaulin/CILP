// Lowering dispatch. Each target is a pure function `lower(program, harness, options)
// => { source, metadata }` in its own file; this picks one by `options.target`
// (default "javascript"). The JSON interpreter is the reference semantics every target
// is checked against, and the feasibility/mode analysis is shared in analyze.js.

import { lowerJavaScript } from "./javascript.js"
import { lowerPython } from "./python.js"

export { lowerJavaScript, lowerPython }

const targets = { javascript: lowerJavaScript, python: lowerPython }

export function lower(program, harness, options = {}) {
  const target = options.target ?? "javascript"
  const fn = targets[target]
  if (!fn) throw new Error(`no lowering for target "${target}"`)
  return fn(program, harness, options)
}
