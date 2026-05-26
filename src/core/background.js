// Background predicate registry. A background predicate is registered by name and
// called when the interpreter meets a goal with that predicate. It is the boundary
// between logic and ordinary JS — a predicate may reason over terms or call out to
// anything (an array, a parser, the network).
//
// A predicate is one of two shapes:
//   - a generator function (args, sub) that yields a substitution for each way the
//     goal succeeds — for non-deterministic predicates and for binding outputs;
//   - a plain function (args, sub) returning `true` (the goal holds, no new
//     bindings), a substitution (the goal holds with these bindings), or a
//     falsy value (the goal fails).
//
// `args` are the goal's argument terms as written; the predicate walks or applies
// the substitution itself. A predicate name is either background (here) or
// program-defined (clauses), never both.

function isGenerator(fn) {
  return fn?.constructor?.name === "GeneratorFunction"
}

export function makeRegistry(predicates = {}) {
  const map = new Map(Object.entries(predicates))
  return {
    has: name => map.has(name),
    register(name, fn) { map.set(name, fn) },
    *solve(name, args, sub) {
      const fn = map.get(name)
      if (!fn) throw new Error(`no background predicate "${name}"`)
      if (isGenerator(fn)) {
        yield* fn(args, sub)
        return
      }
      const result = fn(args, sub)
      if (result === true) yield sub
      else if (result && typeof result === "object") yield result // a substitution
      // a falsy result means the goal fails: yield nothing
    }
  }
}

// Load a background module from a path. The module exports { predicates: {...} }.
// Relative paths resolve against the current working directory.
export async function loadBackground(path) {
  // Imported lazily so the core module itself loads in a browser/Worker, where
  // node: built-ins are unavailable. loadBackground is a Node/Bun-only convenience.
  const { pathToFileURL } = await import("node:url")
  const { isAbsolute, resolve } = await import("node:path")
  let specifier = path
  if (path.includes("://")) specifier = path
  else if (isAbsolute(path)) specifier = pathToFileURL(path).href
  else specifier = pathToFileURL(resolve(process.cwd(), path)).href
  const mod = await import(specifier)
  const predicates = mod.predicates ?? mod.default?.predicates
  if (!predicates) throw new Error(`background module "${path}" must export { predicates }`)
  return makeRegistry(predicates)
}
