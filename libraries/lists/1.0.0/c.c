/* C implementation of the `lists` manifest, v1.0.0 — the deterministic, deconstruction
 * primitives. Each is mode-directed: inputs by value, outputs by pointer, returning
 * whether the call holds. `cons` (construction) and `member` (non-deterministic) are not
 * in the C subset — the C lowering rejects programs that need them. Lists are the cons/nil
 * terms from copper.h, the same representation the JS and Python implementations use. */

#include "copper.h"

/* head(L, X): X is the first element of the non-empty list L. */
static inline bool head(term *l, term **out) {
  if (l->k != CONS) return false;
  *out = l->head;
  return true;
}

/* tail(L, T): T is L with its first element removed. */
static inline bool tail(term *l, term **out) {
  if (l->k != CONS) return false;
  *out = l->tail;
  return true;
}

/* empty(L): L is the empty list. */
static inline bool empty(term *l) {
  return l->k == NIL;
}
