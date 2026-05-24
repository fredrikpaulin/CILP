// copper/shaders/constraint_mask.metal
// Constraint prune mask: one thread per candidate. Each thread compares its
// candidate's packed region against a single forbidden region and writes 1 if they are
// identical. Because both sides share one symbol table, structural equality is integer
// equality. This is the GPU form of the clause-set-membership the CPU constraint store
// does for single-clause candidates (a one-clause program is pruned by too_general /
// redundant exactly when its clause equals the forbidden one).

#include <metal_stdlib>
using namespace metal;

kernel void constraint_mask(
    device const int*  cands     [[buffer(0)]],   // B regions, regionInts each
    device const int*  forbidden [[buffer(1)]],   // one region
    device uchar*      mask      [[buffer(2)]],
    constant uint&     regionInts [[buffer(3)]],
    uint gid [[thread_position_in_grid]])
{
  uint base = gid * regionInts;
  uchar equal = 1;
  for (uint i = 0; i < regionInts; i++) {
    if (cands[base + i] != forbidden[i]) { equal = 0; break; }
  }
  mask[gid] = equal;
}
