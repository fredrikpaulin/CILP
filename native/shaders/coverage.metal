// copper/shaders/coverage.metal
// Full coverage vector for one candidate: one thread per example. Identical to
// unify_batch with the candidate fixed at region 0 — used to confirm coverage after a
// candidate has passed the first-pass filter. Transliteration of the CPU coverage
// reference; the two must agree.

#include <metal_stdlib>
using namespace metal;

#define COPPER_MAX_VARS  32
#define COPPER_MAX_STACK 128
#define TAG_EMPTY 0
#define TAG_VAR 1
#define TAG_CONST 2
#define TAG_COMPOUND 3

struct UnifyParams {
  uint intsPerSlot;
  uint maxArity;
  uint slotsPerTerm;
  uint examples;
};

kernel void coverage(
    device const int*     cand [[buffer(0)]],   // a single candidate term at region 0
    device const int*     exmp [[buffer(1)]],
    device uchar*         mask [[buffer(2)]],
    constant UnifyParams& p    [[buffer(3)]],
    uint gid [[thread_position_in_grid]])
{
  uint intsPerTerm = p.intsPerSlot * p.slotsPerTerm;
  uint baseA = 0;                 // the one candidate
  uint baseB = gid * intsPerTerm; // example gid

  int bindA[COPPER_MAX_VARS];
  int bindB[COPPER_MAX_VARS];
  for (uint i = 0; i < COPPER_MAX_VARS; i++) { bindA[i] = 0; bindB[i] = 0; }

  int4 stack[COPPER_MAX_STACK];
  int sp = 0;
  stack[sp++] = int4(0, 0, 1, 0);

  bool ok = true;

  while (sp > 0 && ok) {
    int4 fr = stack[--sp];

    int aSide = fr.x, aSlot = fr.y;
    for (;;) {
      device const int* buf = (aSide == 0) ? cand : exmp;
      uint o = ((aSide == 0) ? baseA : baseB) + uint(aSlot) * p.intsPerSlot;
      if (buf[o] != TAG_VAR) break;
      int bound = (aSide == 0) ? bindA[buf[o + 1]] : bindB[buf[o + 1]];
      if (bound == 0) break;
      int enc = bound - 1;
      aSide = enc >> 16; aSlot = enc & 0xffff;
    }

    int bSide = fr.z, bSlot = fr.w;
    for (;;) {
      device const int* buf = (bSide == 0) ? cand : exmp;
      uint o = ((bSide == 0) ? baseA : baseB) + uint(bSlot) * p.intsPerSlot;
      if (buf[o] != TAG_VAR) break;
      int bound = (bSide == 0) ? bindA[buf[o + 1]] : bindB[buf[o + 1]];
      if (bound == 0) break;
      int enc = bound - 1;
      bSide = enc >> 16; bSlot = enc & 0xffff;
    }

    device const int* ba = (aSide == 0) ? cand : exmp;
    device const int* bb = (bSide == 0) ? cand : exmp;
    uint oa = ((aSide == 0) ? baseA : baseB) + uint(aSlot) * p.intsPerSlot;
    uint ob = ((bSide == 0) ? baseA : baseB) + uint(bSlot) * p.intsPerSlot;
    int ta = ba[oa], fa = ba[oa + 1];
    int tb = bb[ob], fb = bb[ob + 1];

    if (ta == TAG_VAR && tb == TAG_VAR && aSide == bSide && fa == fb) { continue; }
    if (ta == TAG_VAR) {
      int enc = (bSide << 16) | (bSlot & 0xffff);
      if (aSide == 0) bindA[fa] = enc + 1; else bindB[fa] = enc + 1;
      continue;
    }
    if (tb == TAG_VAR) {
      int enc = (aSide << 16) | (aSlot & 0xffff);
      if (bSide == 0) bindA[fb] = enc + 1; else bindB[fb] = enc + 1;
      continue;
    }
    if (ta == TAG_CONST && tb == TAG_CONST) {
      if (fa != fb) ok = false;
      continue;
    }
    if (ta == TAG_COMPOUND && tb == TAG_COMPOUND) {
      if (fa != fb) { ok = false; continue; }
      for (uint k = 0; k < p.maxArity; k++) {
        int ca = ba[oa + 2 + k];
        int cb = bb[ob + 2 + k];
        if (ca == 0 && cb == 0) continue;
        if (ca == 0 || cb == 0) { ok = false; break; }
        if (sp >= COPPER_MAX_STACK) { ok = false; break; }
        stack[sp++] = int4(aSide, ca, bSide, cb);
      }
      continue;
    }
    ok = false;
  }

  mask[gid] = ok ? 1 : 0;
}
