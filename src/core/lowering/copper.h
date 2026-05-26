/* copper-ilp C runtime — the value model the C lowering target compiles against.
 *
 * Terms are the same shape as the rest of Copper, here as a tagged struct: an atom
 * (a constant), nil (the empty list), or a cons cell. The C lowering compiles unification
 * fully away into mode-directed function calls, so there is no runtime term allocation for
 * deconstruction-only programs — primitives return pointers into existing terms. A program
 * that needs to *build* terms would allocate explicitly; that is outside the deterministic
 * deconstruction subset the C target supports today. */

#ifndef COPPER_H
#define COPPER_H

#include <stdbool.h>
#include <string.h>

typedef enum { ATOM, NIL, CONS } kind;

typedef struct term {
  kind k;
  const char *atom;     /* ATOM: the constant's text */
  struct term *head;    /* CONS: first element */
  struct term *tail;    /* CONS: rest of the list */
} term;

static inline term mk_atom(const char *s) { term t; t.k = ATOM; t.atom = s; t.head = 0; t.tail = 0; return t; }
static inline term mk_nil(void) { term t; t.k = NIL; t.atom = 0; t.head = 0; t.tail = 0; return t; }
static inline term mk_cons(term *h, term *tl) { term t; t.k = CONS; t.atom = 0; t.head = h; t.tail = tl; return t; }

/* Structural equality — the C analogue of comparing two ground terms. */
static inline bool term_eq(const term *a, const term *b) {
  if (a->k != b->k) return false;
  if (a->k == ATOM) return strcmp(a->atom, b->atom) == 0;
  if (a->k == NIL) return true;
  return term_eq(a->head, b->head) && term_eq(a->tail, b->tail);
}

#endif
