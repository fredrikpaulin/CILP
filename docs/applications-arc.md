# ARC transformation induction

Each ARC task is an ILP problem in disguise: a few input/output grid pairs, induce the transformation. This application (`applications/arc/`) frames ARC tasks for Copper, supplies a library of grid predicates, and synthesizes the transformation rule. The honest expectation, per the architecture, is a tractable subset — not state of the art.

## the framing

The transformation is learned per output cell. The head is `output(G, X, Y, C)` — "in grid G, cell (X, Y) has colour C in the output." Positives are the true output cells across every train pair; negatives are those same cells with a wrong colour. The negatives matter: without them, the trivial rule "every cell can be any colour" covers all positives and wins. The background describes the input grids, parameterized by a grid id `G`, so one rule generalizes across all train pairs and the test grid.

```js
import { solveTask } from "./applications/arc/task.js"
import { transposeTask } from "./applications/arc/tasks.js"

const result = await solveTask(transposeTask, transposeTask.bias)
// result.program is the synthesized rule; result.predicted is the test output grid;
// result.correct compares it to the expected output.
```

## the predicate library

`arcBackground(grids)` builds a broad set of grid-id-parameterized predicates: `cell`, `adjacent` (4-connected) and `adjacent8`, `same_color`, `mirror_x` / `mirror_y`, `width` / `height`, `inside`, `count_of`, `connected component`, `bounding_box`, and `is_color`. They are relations over precomputed tuples — the same "facts over a JS array" shape the executor's registry expects. The path to the architecture's ~40 predicates (rotations, per-axis symmetry, neighbour colour, object-size ordering) is more of the same.

## what synthesizes

The geometric and structural transforms synthesize end to end and fast. Identity
(`output(G,X,Y,C) :- cell(G,X,Y,C)`) and transpose (`:- cell(G,Y,X,C)`) are body-length-1
rules found in a handful of candidates. Mirroring is a body-length-2 rule —
`output(G,X,Y,C) :- cell(G,X2,Y,C), mirror_x(G,X,X2)` — and it now synthesizes in tens of
candidates too, where it was once out of reach.

Three language biases on the enumerator (see `enumeration.md`) make the body-2 search
tractable, all driven by declaring what the ARC predicates mean:

- **Modes and connectivity (#044).** A grid id and coordinates are inputs, the derived value
  is the output, so a mirrored column can only be *produced* by `mirror_x`'s output, not
  invented inside a `cell` coordinate slot; and every body literal must touch the head.
- **Types (#045).** Coordinates, colours, grid ids, component ids, and counts are distinct
  types (x and y share one `coord` type so transforms can swap them). A variable can't be a
  colour in one position and a coordinate in another. This is the dominant cut: on the
  `mirror_x` bias the single-clause frontier falls from ~281k (variable-only) to ~108k (modes
  and connectivity) to ~114 (types), and mirror synthesizes in ~70 candidates.
- **Constants (#043).** A bias may declare a typed pool of constant symbols, which the
  enumerator places in matching-type positions. This is what lets a rule depend on a literal:
  `broadcast_column_0` — every column becomes a copy of column 0 — synthesizes as
  `output(G,X,Y,C) :- cell(G,0,Y,C)`, with the literal coordinate `0` in the body. Without the
  pool the hypothesis space is variable-only and the rule is inexpressible.

## what doesn't, yet

Colour-specific *recolouring* ("every red cell becomes blue, all others unchanged") needs both
a colour constant in a body and a notion of inequality/negation for the "all others" clause,
which the current predicate set doesn't provide. Larger multi-object transforms produce body
lengths and variable counts past what the CPU search reaches in a small budget; that is where
batched-GPU candidate evaluation (#035's deferred in-loop piece) and Path B (clingo/ASP, #016)
come in. The predicate library is broad on purpose: it is the substrate those later pieces will
search over.
