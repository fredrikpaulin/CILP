# The GPU layer

Copper's GPU acceleration runs the inner batch-evaluation loop on Apple Silicon via Metal. This document covers the infrastructure layer — the native bridge and its JavaScript bindings. The ILP-specific shaders and the packing that feeds them arrive later (#013, #014); this is the foundation they stand on.

## lineage

The GPU infrastructure is adapted from [Smith](https://github.com/fredrikpaulin/smith), a Bun/Metal compute library by the same author, MIT-licensed, pinned to commit `d3327014`. Copper lifts the parts that any Metal compute system needs and leaves behind Smith's machine-learning stack (tensors, autograd, neural-network ops, model loaders). Each lifted file carries an attribution header noting the original and the changes.

What was lifted:

- `native/copper_gpu.{h,m}` — the Objective-C Metal bridge, a flat C API across which no Objective-C types cross. Renamed from Smith's `gpu_bridge`, with the async dispatch path (`end_async`/`wait`) and the unused single-shot `dispatch_sync` removed: Copper's batch evaluation is synchronous, so the async token machinery is dead weight.
- `src/engine/gpu/device.js` — Bun FFI bindings to the bridge, plus buffer and dispatch helpers. Initializes the Metal device once at import time.
- `src/engine/gpu/dispatch.js` — the `run` helper that turns an op-level call into Metal command encoding. Smith's ML-specific parameter builders (matmul, broadcast, axis-reduce) and the f16 kernel-name suffix were dropped.
- `src/engine/gpu/pool.js` — a power-of-two buffer pool. Bucket sizing is tuned against Copper's batch-scoped allocation pattern in #013.
- `src/engine/gpu/profile.js` — per-kernel GPU timing and a benchmark harness, the measurement tool #015 uses to report speedup.

## building

The native bridge and shaders are built with `build.sh`, which requires Apple Silicon and the Xcode command line tools:

```sh
bash build.sh
```

This compiles `native/libcopper.dylib` from `native/copper_gpu.m`. The shader step is skipped until the `.metal` files land in #014. The built `.dylib` and `.metallib` are generated artifacts and are not committed.

## a note on where this sits

The GPU modules are present but deliberately **not** wired into the engine's import graph. `device.js` initializes Metal at import time, which only works on a Mac with the dylib built — so importing it from the CPU path would break the engine everywhere else. Nothing in `synthesize`, `enumerate`, or `constrain` imports it. The ops layer (#014) is what will pull it in, behind a capability check. Until then, the layer is exercised by one Apple-Silicon-only smoke test (`tests/gpu-smoke.test.js`), which compiles a trivial kernel from source, dispatches it, and reads the result back; it is skipped on every other platform.

## backend selection and measured speedup

The batch ops choose where to run. `unifyBatch(..., { backend })` takes `"cpu"`,
`"gpu"`, or `"auto"`; `"auto"` uses the GPU when `gpuAvailable()` reports Metal is
present and the dylib is built, and falls back to the CPU reference otherwise. The
fallback is exact — the GPU and CPU paths produce identical masks, which is checked on
Apple Silicon by `tests/ops-gpu.test.js` and again, on a large batch, by the benchmark
below.

The speedup that matters here is C2's: batched structural unification on the GPU versus
the CPU reference. Measure it on Apple Silicon:

```sh
bash build.sh
bun bench/gpu_bench.js [candidates] [examples]   # e.g. 4000 400
```

The harness builds a B × E frontier of packed-term pairs, runs both backends, confirms
the GPU result matches the CPU result bit for bit, and reports wall-clock time for each
(including pack, dispatch, and readback), the per-kernel GPU time from the profiler, and
the speedup. On a non-Metal platform it prints CPU-only timing and notes the GPU is
unavailable.

### the measured result

On an M-series Mac, a 4000 × 400 frontier — 1.6 million `(candidate, example)` pairs — runs in **449.8 ms** on the CPU reference and **13.5 ms** on the GPU, the two results identical bit for bit: a **33× wall-clock speedup**, at a peak device-memory delta of 1.6 MB. The kernel itself runs in **1.42 ms** (one dispatch), so raw structural-unification throughput is ~316× the CPU (about 1.1 billion pairs/second). The gap between the 316× kernel and the 33× wall clock is host-side work — packing 1.6 M term regions into buffers, the dispatch, and the readback — which is CPU time the GPU can't remove. The honest reading: the kernel is roughly two orders of magnitude faster, and packing, not unification, is now the bottleneck on the device path.

What it does **not** measure is end-to-end synthesis speedup on the background-using
benchmark suite — that coverage check is full SLD resolution with arbitrary JavaScript
background predicates, which cannot move to the GPU. Putting the GPU inside the
synthesize search (a structural pre-filter, or packed background facts) is tracked as
#035. The honest headline is the structural-unification primitive, measured against its
own CPU reference on a characterized workload.
