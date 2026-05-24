// Backend selection for the batch ops. The GPU path is used when Metal is available
// and the dylib is built; otherwise everything falls back to the CPU reference, which
// produces identical results. The capability check imports the GPU device module —
// which initializes Metal at import time — inside a try, so a non-Metal platform (or
// an unbuilt dylib) simply reports "no GPU" rather than crashing. The result is cached.

let _available = null

export function gpuAvailable() {
  if (_available === null) {
    _available = import("../gpu/device.js").then(() => true, () => false)
  }
  return _available
}

// "cpu" / "gpu" pass through; "auto" (or undefined via the default) picks the GPU when
// it's available. Ops default to "cpu" so tests stay deterministic and never probe
// Metal unless asked.
export async function resolveBackend(requested = "cpu") {
  if (requested !== "auto") return requested
  return (await gpuAvailable()) ? "gpu" : "cpu"
}
