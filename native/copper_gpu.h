// copper/native/copper_gpu.h
// Flat C API for the Metal GPU bridge. No Objective-C types cross this boundary.
// Every function takes and returns C primitives or opaque pointers.
//
// Adapted from Smith (a Bun/Metal compute library, MIT, © Fredrik Paulin),
// native/gpu_bridge.h, pinned to Smith commit d3327014. Changes: renamed
// smith_*/SMITH_* → copper_*/COPPER_*, and dropped the async dispatch path
// (end_async/wait) and the unused single-shot dispatch_sync convenience — Copper's
// batch evaluation is synchronous.

#ifndef COPPER_GPU_BRIDGE_H
#define COPPER_GPU_BRIDGE_H

#include <stdint.h>
#include <stddef.h>

// Storage modes for buffer allocation
#define COPPER_SHARED  0  // CPU + GPU coherent (unified memory, zero-copy)
#define COPPER_PRIVATE 1  // GPU-only (faster for intermediates)

// --- Lifecycle ---

// Initialize Metal device + command queue. Returns opaque device context.
void* copper_init(void);

// Release device context and all associated resources.
void copper_destroy(void* ctx);

// --- Device Info ---

// Returns the GPU name as a null-terminated string. Caller must free().
char* copper_device_name(void* ctx);

// Returns maximum threadgroup memory size in bytes.
uint64_t copper_max_threadgroup_memory(void* ctx);

// Returns maximum threads per threadgroup.
uint64_t copper_max_threads_per_threadgroup(void* ctx);

// --- Buffer Management ---

// Allocate a Metal buffer. mode: COPPER_SHARED or COPPER_PRIVATE.
void* copper_alloc(void* ctx, uint64_t bytes, uint32_t mode);

// Get raw pointer to shared buffer contents. Only valid for COPPER_SHARED buffers.
void* copper_buffer_contents(void* buffer);

// Get buffer length in bytes.
uint64_t copper_buffer_length(void* buffer);

// Release a buffer (decrements retain count).
void copper_release_buffer(void* buffer);

// Self-test: alloc+release via public API. Returns bytes freed (>0 if OK).
int64_t copper_test_release(void* ptr);

// Self-test: alloc, use in Metal command, release. Returns bytes freed.
int64_t copper_test_release_after_use(void* ptr);

// --- Shader Library ---

// Load a precompiled .metallib from disk. Returns library pointer.
void* copper_load_library(void* ctx, const char* path);

// Load shader library from source string. Returns library pointer, or NULL on error.
// If error_out is non-NULL, writes error message (caller must free).
void* copper_compile_source(void* ctx, const char* source, char** error_out);

// Create a compute pipeline for a named kernel function. Returns pipeline pointer.
void* copper_create_pipeline(void* ctx, void* library, const char* fn_name);

// --- Compute Dispatch ---

// Opaque handle for a command encoder session.
typedef struct CopperEncoder CopperEncoder;

// Begin a new command buffer + compute encoder.
CopperEncoder* copper_begin(void* ctx);

// Bind a buffer at the given index.
void copper_set_buffer(CopperEncoder* enc, void* buffer, uint32_t index);

// Bind inline bytes at the given index. Data is copied into the command buffer.
void copper_set_bytes(CopperEncoder* enc, const void* data, uint32_t length, uint32_t index);

// Set the active compute pipeline.
void copper_set_pipeline(CopperEncoder* enc, void* pipeline);

// Set threadgroup memory size at the given index.
// Required for kernels using [[threadgroup(n)]] dynamic shared memory.
void copper_set_threadgroup_memory(CopperEncoder* enc, uint64_t length, uint32_t index);

// Dispatch with explicit grid and threadgroup dimensions.
void copper_dispatch(CopperEncoder* enc,
                     uint64_t grid_x, uint64_t grid_y, uint64_t grid_z,
                     uint64_t group_x, uint64_t group_y, uint64_t group_z);

// End encoding, submit, and block until GPU finishes.
void copper_end_sync(CopperEncoder* enc);

// --- Profiling ---

// Timing result from a timed dispatch.
typedef struct {
  double gpu_start;     // GPU start time in seconds (Mach absolute time)
  double gpu_end;       // GPU end time in seconds
  double gpu_ms;        // GPU duration in milliseconds
} CopperTiming;

// End encoding with timing. Blocks until complete, returns timing info.
// Caller must free the returned CopperTiming pointer.
CopperTiming* copper_end_timed(CopperEncoder* enc);

// Get current GPU memory allocation (allocated bytes on device).
uint64_t copper_allocated_size(void* ctx);

// Get a buffer's retain count (for diagnostics).
int64_t copper_buffer_retain_count(void* buffer);

#endif // COPPER_GPU_BRIDGE_H
