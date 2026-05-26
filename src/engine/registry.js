// The file-based library registry. Curated harness libraries are distributed as files:
//
//   <root>/<library>/<version>/manifest.json
//   <root>/<library>/<version>/<target>.js      (e.g. javascript.js)
//
// `root` is a local directory or an HTTP base URL — distribution is git or HTTP fetch
// from the repository. There is no publishing API, no versioning service, no access
// controls, and no user-uploaded libraries in v1: running arbitrary fetched code raises
// sandboxing questions deferred past v1.x (Appendix A §A.5.1). Agents wanting custom
// predicates self-host the engine and load their own libraries directly.
//
// Reading a manifest or implementation *source* is safe over either transport. Actually
// *loading* an implementation runs its code, so load() is local-only — over HTTP you
// fetch the files first, then load them locally.

import { loadManifest, loadHarness } from "../core/index.js"

const isUrl = root => root.includes("://")

// Per-target implementation file extension. `load()` stays .js — it imports and runs the
// implementation, which only works for the JavaScript target; other targets are fetched as
// source via implementationSource and run by their own runtime.
const TARGET_EXTENSION = { javascript: ".js", python: ".py", sql: ".sql", c: ".c" }

// Numeric, dotted-version comparison. Enough for the curated set; not a full semver.
function compareVersions(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

async function readJson(location) {
  if (isUrl(location)) {
    const res = await fetch(location)
    if (!res.ok) throw new Error(`fetch ${location} failed: ${res.status}`)
    return res.json()
  }
  return Bun.file(location).json()
}

async function readText(location) {
  if (isUrl(location)) {
    const res = await fetch(location)
    if (!res.ok) throw new Error(`fetch ${location} failed: ${res.status}`)
    return res.text()
  }
  return Bun.file(location).text()
}

export function libraryRegistry(root = "libraries") {
  const base = root.replace(/\/+$/, "")
  const at = (...parts) => [base, ...parts].join("/")

  // Every (library, version) the registry holds, sorted by name then version. Local
  // only — an HTTP root has no directory listing without the server's index endpoint.
  async function list() {
    if (isUrl(base)) throw new Error("list() requires a local registry root")
    const { readdir } = await import("node:fs/promises")
    const out = []
    let libraries
    try { libraries = await readdir(base) } catch { return out }
    for (const library of libraries) {
      let versions
      try { versions = await readdir(at(library)) } catch { continue }
      for (const version of versions) {
        if (await Bun.file(at(library, version, "manifest.json")).exists())
          out.push({ library, version })
      }
    }
    return out.sort((a, b) => a.library.localeCompare(b.library) || compareVersions(a.version, b.version))
  }

  async function versions(library) {
    return (await list()).filter(e => e.library === library).map(e => e.version)
  }

  // Resolve "latest" to the highest available version; pass any other version through.
  async function resolveVersion(library, version) {
    if (version !== "latest") return version
    const vs = await versions(library)
    if (vs.length === 0) throw new Error(`no versions of "${library}"`)
    return vs[vs.length - 1] // list() is ascending by version
  }

  // Load and validate the manifest for a (library, version).
  async function manifest(library, version) {
    const v = await resolveVersion(library, version)
    return loadManifest(await readJson(at(library, v, "manifest.json")))
  }

  // The implementation source text for a target — what the server serves and an agent
  // fetches. Reading text never executes the code.
  async function implementationSource(library, version, target = "javascript") {
    const v = await resolveVersion(library, version)
    return readText(at(library, v, `${target}${TARGET_EXTENSION[target] ?? ".js"}`))
  }

  // Resolve a (library, version, target) into a verified background registry: read the
  // manifest, import the implementation, check its recorded hash against the manifest
  // (loadHarness), and build the registry. Local only — importing runs the code.
  async function load(library, version, target = "javascript") {
    if (isUrl(base))
      throw new Error("load() runs implementation code and requires a local registry; fetch the files first")
    const v = await resolveVersion(library, version)
    const man = await manifest(library, v)
    const { pathToFileURL } = await import("node:url")
    const { resolve } = await import("node:path")
    const implPath = resolve(at(library, v, `${target}.js`))
    const implementation = await import(pathToFileURL(implPath).href)
    const registry = await loadHarness(man, implementation)
    return { library, version: v, target, manifest: man, registry }
  }

  return { root: base, list, versions, resolveVersion, manifest, implementationSource, load }
}
