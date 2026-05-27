// copper/src/engine/gpu/device.js
// Thin bun:ffi wrapper around libcopper.dylib. Loads the native library and
// initializes the Metal device once at import time — so this module only loads on
// Apple Silicon with the dylib built (run build.sh). It is deliberately kept out of
// the engine's import graph until the ops layer (#014) needs it.
//
// Adapted from Smith (a Bun/Metal compute library, MIT, © Fredrik Paulin),
// src/device.js, pinned to Smith commit d3327014. Changes: renamed smith_*→copper_*
// and the library/metallib names, repathed the dylib/metallib for the deeper
// directory, and dropped the async dispatch path (end_async/wait).

import { dlopen, FFIType, ptr, toArrayBuffer, CString } from "bun:ffi"
import { resolve } from "node:path"

const LIB_PATH = resolve(import.meta.dir, "../../../native/bridge", "libcopper.dylib")

const { symbols: lib } = dlopen(LIB_PATH, {
  // Lifecycle
  copper_init:                       { returns: FFIType.ptr, args: [] },
  copper_destroy:                    { returns: FFIType.void, args: [FFIType.ptr] },

  // Device info
  copper_device_name:                { returns: FFIType.ptr, args: [FFIType.ptr] },
  copper_max_threadgroup_memory:     { returns: FFIType.u64, args: [FFIType.ptr] },
  copper_max_threads_per_threadgroup:{ returns: FFIType.u64, args: [FFIType.ptr] },

  // Buffers
  copper_alloc:                      { returns: FFIType.ptr, args: [FFIType.ptr, FFIType.u64, FFIType.u32] },
  copper_buffer_contents:            { returns: FFIType.ptr, args: [FFIType.ptr] },
  copper_buffer_length:              { returns: FFIType.u64, args: [FFIType.ptr] },
  copper_release_buffer:             { returns: FFIType.void, args: [FFIType.ptr] },

  // Shader library
  copper_load_library:               { returns: FFIType.ptr, args: [FFIType.ptr, FFIType.cstring] },
  copper_compile_source:             { returns: FFIType.ptr, args: [FFIType.ptr, FFIType.cstring, FFIType.ptr] },
  copper_create_pipeline:            { returns: FFIType.ptr, args: [FFIType.ptr, FFIType.ptr, FFIType.cstring] },

  // Compute — granular, synchronous
  copper_begin:                      { returns: FFIType.ptr, args: [FFIType.ptr] },
  copper_set_buffer:                 { returns: FFIType.void, args: [FFIType.ptr, FFIType.ptr, FFIType.u32] },
  copper_set_bytes:                  { returns: FFIType.void, args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.u32] },
  copper_set_threadgroup_memory:     { returns: FFIType.void, args: [FFIType.ptr, FFIType.u64, FFIType.u32] },
  copper_set_pipeline:               { returns: FFIType.void, args: [FFIType.ptr, FFIType.ptr] },
  copper_dispatch:                   { returns: FFIType.void, args: [FFIType.ptr, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64, FFIType.u64] },
  copper_end_sync:                   { returns: FFIType.void, args: [FFIType.ptr] },

  // Profiling
  copper_end_timed:                  { returns: FFIType.ptr, args: [FFIType.ptr] },
  copper_allocated_size:             { returns: FFIType.u64, args: [FFIType.ptr] },

  // Diagnostics
  copper_test_release:               { returns: FFIType.i64, args: [FFIType.ptr] },
  copper_test_release_after_use:     { returns: FFIType.i64, args: [FFIType.ptr] },
  copper_buffer_retain_count:        { returns: FFIType.i64, args: [FFIType.ptr] }
})

// Storage mode constants
const SHARED = 0
const PRIVATE = 1

// Initialize Metal device once
const ctx = lib.copper_init()
if (!ctx) throw new Error("copper: failed to initialize Metal device. Apple Silicon GPU required.")

// Resolve shader library path (loaded lazily on first pipeline request)
const METALLIB_PATH = resolve(import.meta.dir, "../../../native/shaders", "copper.metallib")

let _shaderLib = null
function shaderLib() {
  if (!_shaderLib) {
    _shaderLib = lib.copper_load_library(ctx, Buffer.from(METALLIB_PATH + "\0"))
    if (!_shaderLib) throw new Error(`copper: failed to load shader library at ${METALLIB_PATH}`)
  }
  return _shaderLib
}

// Pipeline cache: kernel name → pipeline pointer
const _pipelines = new Map()

function pipeline(kernelName) {
  let p = _pipelines.get(kernelName)
  if (!p) {
    p = lib.copper_create_pipeline(ctx, shaderLib(), Buffer.from(kernelName + "\0"))
    if (!p) throw new Error(`copper: kernel '${kernelName}' not found in shader library`)
    _pipelines.set(kernelName, p)
  }
  return p
}

// --- Device info ---

function deviceName() {
  const namePtr = lib.copper_device_name(ctx)
  return new CString(namePtr).toString()
}

function maxThreadgroupMemory() {
  return Number(lib.copper_max_threadgroup_memory(ctx))
}

function maxThreadsPerThreadgroup() {
  return Number(lib.copper_max_threads_per_threadgroup(ctx))
}

// --- Buffer operations ---

function alloc(bytes, mode = SHARED) {
  const buf = lib.copper_alloc(ctx, bytes, mode)
  if (!buf) throw new Error(`copper: failed to allocate ${bytes} bytes (mode=${mode})`)
  return buf
}

function bufferContents(buffer) {
  return lib.copper_buffer_contents(buffer)
}

function bufferLength(buffer) {
  return Number(lib.copper_buffer_length(buffer))
}

function releaseBuffer(buffer) {
  lib.copper_release_buffer(buffer)
}

function bufferRetainCount(buffer) {
  return Number(lib.copper_buffer_retain_count(buffer))
}

// Create a typed array view into a shared Metal buffer's memory. The zero-copy
// bridge: JS reads/writes the same bytes the GPU sees.
function viewBuffer(buffer, byteLength, TypedArray = Float32Array) {
  const rawPtr = lib.copper_buffer_contents(buffer)
  const ab = toArrayBuffer(rawPtr, 0, byteLength)
  return new TypedArray(ab)
}

// --- Compute dispatch ---

function begin() {
  return lib.copper_begin(ctx)
}

function setBuffer(enc, buffer, index) {
  lib.copper_set_buffer(enc, buffer, index)
}

function setBytes(enc, data, length, index) {
  lib.copper_set_bytes(enc, data, length, index)
}

function setThreadgroupMemory(enc, length, index) {
  lib.copper_set_threadgroup_memory(enc, length, index)
}

function setPipeline(enc, pipelinePtr) {
  lib.copper_set_pipeline(enc, pipelinePtr)
}

function dispatch(enc, gridX, gridY, gridZ, groupX, groupY, groupZ) {
  lib.copper_dispatch(enc, gridX, gridY, gridZ, groupX, groupY, groupZ)
}

function endSync(enc) {
  lib.copper_end_sync(enc)
}

// --- Profiling ---

function endTimed(enc) {
  const timingPtr = lib.copper_end_timed(enc)
  if (!timingPtr) return { gpuStart: 0, gpuEnd: 0, gpuMs: 0 }
  // CopperTiming struct: 3 doubles (8 bytes each) = 24 bytes
  const ab = toArrayBuffer(timingPtr, 0, 24)
  const f64 = new Float64Array(ab)
  // Bun's FFI has no free(); the 24-byte struct leaks per timed dispatch. Accepted.
  return { gpuStart: f64[0], gpuEnd: f64[1], gpuMs: f64[2] }
}

function allocatedSize() {
  return Number(lib.copper_allocated_size(ctx))
}

// Compile a shader from a source string (for development / runtime kernels).
function compileSource(source) {
  const errBuf = new BigInt64Array(1)
  const library = lib.copper_compile_source(ctx, Buffer.from(source + "\0"), ptr(errBuf))
  if (!library) {
    const errPtr = errBuf[0]
    const msg = errPtr ? new CString(Number(errPtr)).toString() : "unknown error"
    throw new Error(`copper: shader compilation failed: ${msg}`)
  }
  return library
}

function createPipeline(library, fnName) {
  const p = lib.copper_create_pipeline(ctx, library, Buffer.from(fnName + "\0"))
  if (!p) throw new Error(`copper: kernel '${fnName}' not found`)
  return p
}

export {
  SHARED, PRIVATE,
  ctx, deviceName, maxThreadgroupMemory, maxThreadsPerThreadgroup,
  alloc, bufferContents, bufferLength, releaseBuffer, bufferRetainCount, viewBuffer,
  shaderLib, pipeline, compileSource, createPipeline,
  begin, setBuffer, setBytes, setThreadgroupMemory, setPipeline, dispatch, endSync,
  endTimed, allocatedSize
}
