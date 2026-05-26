// copper-ilp/core — the universal layer. No native, GPU, or Bun-specific
// dependencies; runs in any JavaScript runtime. The term language, the JSON program
// interpreter, background predicates, normalization, verification, harness manifests,
// and target lowerings.

export { copperSchema, validate, isTerm, isAtom, isClause, isProgram } from "./schema.js"
export { unify, walk, applySubstitution, termEqual } from "./unify.js"
export { interpret, firstProof } from "./resolve.js"
export { makeRegistry, loadBackground } from "./background.js"
export { normalize, denormalize } from "./normalize.js"
export { covers, coverage, verify } from "./verify.js"
export {
  validateManifest, loadManifest, semanticHash, withHash,
  verifyManifest, checkImplementation, loadHarness
} from "./harness.js"
export { conform } from "./conformance.js"
export { lower, lowerJavaScript, lowerPython, lowerSql, lowerC, LOWERING_VERSION } from "./lowering/index.js"
