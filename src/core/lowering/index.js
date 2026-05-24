// Lowering dispatch. Each target is a pure function `lower(program, harness, options)
// => { source, metadata }` in its own file; this picks one by `options.target`
// (default "javascript"). The JSON interpreter is the reference semantics every
// target is checked against.

import { lowerJavaScript } from "./javascript.js"

export { lowerJavaScript }

export function lower(program, harness, options = {}) {
  const target = options.target ?? "javascript"
  if (target === "javascript") return lowerJavaScript(program, harness, options)
  throw new Error(`no lowering for target "${target}"`)
}
