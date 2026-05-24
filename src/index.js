// Copper — public entry point. The default import is the full system (core plus
// engine). For the universal layer alone, import "copper-ilp/core"; for the engine,
// "copper-ilp/engine".

import pkg from "../package.json"

export const VERSION = pkg.version

export * from "./engine/index.js"
