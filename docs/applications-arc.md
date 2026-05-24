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

## what synthesizes, and what doesn't

Two limits decide the tractable subset, and both are worth stating plainly.

**The hypothesis space is variable-only.** Clauses contain variables, never constants, so a transformation that depends on a *specific* colour — "recolour every red cell blue" — cannot be expressed: it needs the constants `red` and `blue` in the clause. So colour-specific recolouring is out of reach until the bias schema admits constants. What *is* expressible is geometric and structural: identity (`output(G,X,Y,C) :- cell(G,X,Y,C)`), transpose (`:- cell(G,Y,X,C)`), and mirroring (`:- cell(G,X2,Y,C), mirror_x(G,X,X2)`).

**Arity-4 predicates explode the naive enumerator.** `cell/4` over `n` variables generates `n⁴` body atoms, so a body-length-1 rule is found fast (identity and transpose synthesize end to end in tens of milliseconds), but a body-length-2 rule — which is what mirroring needs — produces a frontier of tens of thousands the CPU search can't chew through in a reasonable budget. Mirroring is therefore demonstrated by *applying* a hand-given rule (which confirms the framing and the `mirror_x` predicate are correct), not by synthesizing it. Closing that gap is exactly what the GPU-in-search work (#035), mode constraints, Path B (#016), and LLM-assisted per-task bias (#019) are for.

So the demo proves the pipeline on the geometric transforms it can reach, and is honest that the broader ARC corpus needs the pieces still on the backlog. The predicate library is broad on purpose: it is the substrate those later pieces will search over.
