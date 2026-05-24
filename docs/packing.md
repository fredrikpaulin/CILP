# The packing layer

The packing layer converts the symbolic world — JSON terms and clauses — into the flat, fixed-shape buffers a Metal kernel can read, and back. This document covers the layout it commits to and the `PackedBuffer` that carries it. The pack/unpack passes that fill these buffers arrive in #013; the kernels that consume them in #014.

## the slot

Every term node packs into a fixed-size **slot** of `i32`s:

```
[ type_tag, functor_id, child_offset_0 .. child_offset_{maxArity-1} ]
```

`type_tag` is one of `EMPTY` (0), `VAR` (1), `CONST` (2), `COMPOUND` (3). `functor_id` indexes a string table, or holds a constant value. `child_offsets` point to child slots, for compounds. A slot is `2 + maxArity` int32s — with `maxArity = 4`, that's 6 ints, 24 bytes, matching the architecture's figure.

## layouts

Three buffer kinds, each described by a layout descriptor (a plain object whose `$id` is the layout's URI), validated by a JSON Schema in core:

- **packed term** (`termLayout(maxArity, maxDepth)`) — a term reserves up to `maxDepth × maxArity` slots. That cap (20 slots at depth 5, arity 4) covers the small terms ILP produces; deeper terms are rejected at pack time. This is the architecture's "fixed-size slot determined by `max_depth × max_arity`."
- **packed clause** (`clauseLayout(maxArity, maxBodyLength)`) — the head atom plus up to `maxBodyLength` body atoms. Each atom is a predicate id followed by `maxArity` argument slots, one per argument, because hypothesis-clause arguments are variables. General terms appear only in examples and use the term layout.
- **coverage mask** (`coverageMaskLayout(candidates, examples)`) — one byte per `(candidate, example)` pair, the output of the batched unification kernel.

## PackedBuffer

A `PackedBuffer` is a typed view over a flat buffer plus the layout descriptor that gives the bytes meaning:

```
{ buffer, view, layout, byteLength, offset }
```

`buffer` is the backing MTLBuffer pointer when the buffer comes from the Metal pool, or `null` when it's CPU-backed. `view` is the typed array — and this is the key to developing the packing layer without a GPU: a typed view over a plain `ArrayBuffer` behaves identically to one over a Metal shared buffer, since both are zero-copy windows onto bytes. So `cpuPackedBuffer` (in `buffer.js`, pure JavaScript) and `poolPackedBuffer` (in `gpu/poolbuffer.js`, Metal-backed) are interchangeable. The pack/unpack round-trip is verified on a CPU buffer in CI; the pool-backed variant is verified by a Mac-only test that writes through the view and reads it back from the GPU-visible buffer.

The Metal-backed allocator deliberately lives apart from `buffer.js` and is not re-exported from the engine entry point, because importing it initializes Metal — which only works on Apple Silicon. Allocation and release go through the lifted buffer pool.

## pack and unpack

`packTermInto(view, base, layout, symbols, term)` writes one term into a slot region: the root at slot 0, children allocated from a cursor at slots 1 and up, each compound's `child_offsets` pointing at its arguments. A `child_offset` of 0 means "no argument" — unambiguous, because slot 0 is always the root and never a child. `unpackTermFrom` reverses it. The round-trip is exact across the full term language: constants of every value type, variables, and nested compounds.

```js
import { packTerms, makeSymbols } from "copper-ilp/engine"
import { unpackTerms } from "copper-ilp/engine"

const { packed, symbols } = packTerms(terms, layout)   // one buffer, shared symbol table
const back = unpackTerms(packed, terms.length, layout, symbols)
```

### the symbol table

Functor names and constant values are interned into a shared table, so the buffer holds only integers — which is what the GPU compares, and what `unpack` maps back. The table is shared across a whole batch, so the same symbol gets the same id in candidate and example terms; that shared numbering is exactly what makes them comparable on the device. Functors and string constants that happen to be equal share an id, which is harmless: the slot's `type_tag` keeps a compound `f(...)` distinct from a constant `f`.

### variable names are not packed

Only a variable's integer id is stored. `unpack` restores a canonical name `V{id}`. The executor and the kernels match on ids, so names are cosmetic at this layer; the original symbolic names are recovered, when a result is presented, through the normalization map — not through unpacking.

### batch-scoped lifecycle

`packTerms` makes a single allocation for the whole batch and returns it as one `PackedBuffer`. ILP enumeration produces huge numbers of transient candidates, so per-candidate retain/release would thrash the pool; instead a generation packs everything into one buffer and frees it as a unit when it moves on. `batchByteLength(layout, count)` gives the budget — for a B × E batch, `count = B × E` term regions, matching the architecture's ~240 MB estimate at 10K candidates × 50 examples.
