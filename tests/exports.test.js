// The package split as a contract: copper-ilp/core is engine-free, copper-ilp/engine
// adds the synthesis pieces on top of core, and the default entry has everything.

import { test, expect } from "bun:test"
import * as core from "../src/core/index.js"
import * as engine from "../src/engine/index.js"
import * as main from "../src/index.js"

test("core exposes the universal layer and nothing from the engine", () => {
  expect(typeof core.interpret).toBe("function")
  expect(typeof core.coverage).toBe("function")
  expect(typeof core.validate).toBe("function")
  expect(typeof core.unify).toBe("function")
  expect(typeof core.normalize).toBe("function")
  // engine symbols must not leak into core
  expect(core.synthesize).toBeUndefined()
  expect(core.enumerate).toBeUndefined()
  expect(core.makeConstraints).toBeUndefined()
})

test("engine adds the synthesis pieces and re-exports core", () => {
  expect(typeof engine.synthesize).toBe("function")
  expect(typeof engine.enumerate).toBe("function")
  expect(typeof engine.makeConstraints).toBe("function")
  expect(typeof engine.interpret).toBe("function") // core, re-exported
})

test("the default entry has VERSION and the full surface", () => {
  expect(typeof main.VERSION).toBe("string")
  expect(typeof main.synthesize).toBe("function")
  expect(typeof main.interpret).toBe("function")
})
