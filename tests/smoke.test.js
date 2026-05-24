import { test, expect } from "bun:test"
import { synthesize, VERSION } from "../src/index.js"

test("exports a synthesize function", () => {
  expect(typeof synthesize).toBe("function")
})

test("VERSION tracks package.json", () => {
  expect(VERSION).toBe("0.0.0")
})

test("synthesize rejects an invalid problem", async () => {
  await expect(synthesize({})).rejects.toThrow(/invalid problem/)
})
