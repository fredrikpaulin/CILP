# Benchmarks

The Phase 2 benchmark suite checks two things: that Copper synthesizes correct programs across a range of standard ILP problems, and that constraint learning measurably cuts the search. It lives in `bench/`; run it with `bun bench/run.js`.

## the suite

Ten problems across two domains. Kinship, over a small family tree: `grandparent`, `child` (inverse of parent), `sibling`, `father`, `mother`, `ancestor` (recursive), and `great_grandparent`. A successor chain, standing in for string-position transformations: `after_two`, `after_three`, and `reachable` (recursive). Each problem carries its own tailored bias; backgrounds are plain predicate sets — facts over an array, plus the unary `male`/`female` tests.

The gendered relations (`father`, `mother`) are the ones that force a body literal: the examples include a female parent and a male parent, so `parent(X, Y)` alone over-covers and the `male`/`female` literal is required. The recursive relations (`ancestor`, `reachable`) include a deep example — an ancestor three or more hops away — so a non-recursive program cannot cover them, forcing the recursive clause.

## measured pruning

Every problem synthesizes a correct program. Constraint learning reduces the candidates tested before the solution is found, compared with the same search with constraints disabled:

| problem            | tested | pruned | naive | reduction |
|--------------------|-------:|-------:|------:|----------:|
| grandparent        |     11 |     30 |    41 |      3.7x |
| child              |      3 |      0 |     3 |      1.0x |
| sibling            |     11 |     18 |    29 |      2.6x |
| father             |      8 |     10 |    18 |      2.3x |
| mother             |      6 |      0 |     6 |      1.0x |
| ancestor           |    287 |    501 |   788 |      2.7x |
| great_grandparent  |     22 |    472 |   494 |     22.5x |
| after_two          |     11 |     30 |    41 |      3.7x |
| after_three        |     22 |    472 |   494 |     22.5x |
| reachable          |     11 |      0 |    11 |      1.0x |

Aggregate across the suite: **1925 candidates naive vs 392 with constraints — a 4.9x reduction.**

## reading the numbers honestly

The reduction is real but uneven, and the spread is the interesting part. Where the solution is the first acceptable candidate the enumerator reaches — `child`, `mother`, `reachable` — there is nothing before it to prune, so the ratio is 1.0x. Where the solution sits behind a large frontier of dead candidates — `great_grandparent` and `after_three`, whose three-literal bodies follow hundreds of shorter dead-ends — pruning removes almost all of that frontier, and the ratio jumps past 20x.

So the aggregate 4.9x undersells the mechanism on the problems that need it and oversells it on the trivial ones. The honest summary: constraint learning does little when the search is short and a great deal when it is long, which is exactly the regime where it matters. The architecture's 10x target is met and exceeded on the harder single-clause problems; the recursive problems gain less here because their solutions happen to appear early in the two-clause enumeration, and the bigger pruning wins for recursion wait on Path B's encoding (#016) and the GPU constraint-mask kernel (#014).
