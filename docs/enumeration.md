# Hypothesis enumeration

The Path A enumerator (`enumerate`) generates candidate programs that fit a bias, lazily and in order of increasing complexity. It is the default source of candidates for `synthesize`; the search loop pulls programs from it and tests each with the coverage harness.

## the hypothesis space

A candidate is a `Program` of one or more clauses. The enumerator works over a restricted, well-defined space:

- **Variables, and optionally constants.** By default atom arguments are variables, and constants enter a problem through the examples and the background predicates — the standard datalog-style representation, bounded by `max_variables`. A bias may opt into a pool of constant symbols (`bias.constants`); the enumerator then also places those constants in body positions, so a rule that depends on a literal value (`output(G,X,Y,C) :- cell(G,0,Y,C)`) becomes expressible. Constant-free clauses of a given size are always enumerated before constant-bearing ones, so adding the pool never delays a simpler explanation.
- **Heads are canonical.** A head predicate of arity `a` is written over the first `a` variables — `t(V0)`, `grandparent(V0, V1)`. The head introduces those variables; the body relates them, optionally introducing fresh ones.
- **Bodies are sets.** A clause body is a set of distinct atoms, so the order of atoms within a clause is not a source of duplicate candidates.

## ordering

Candidates come out in nondecreasing complexity:

1. **Clause count** — every one-clause program before any two-clause program, and so on up to `max_clauses`.
2. **Body length** — within a clause, shorter bodies first, up to `max_body_length`.
3. **Variable count** — within a body length, fewer variables first, up to `max_variables`.

Single-clause programs stream lazily. Multi-clause programs require the set of clauses, which is materialized only once the single-clause stream is exhausted — so a problem solved by one clause never pays for the multi-clause machinery.

## canonical form and completeness

Clauses are generated in a **contiguous-variable canonical form**: a clause that uses `n` variables uses exactly `V0..V(n-1)`. This removes the renaming duplicates that differ only by gaps in the variable numbering, and ensures each clause shape is generated once, at its true variable count.

What remains — clauses that differ by a permutation of variables, or programs that differ by clause order — is left to the constraint learner's `redundant` check. The enumerator deliberately over-generates rather than risk skipping a candidate, so enumeration is **complete up to variable renaming**: every program in the space (that isn't a pure renaming of one already produced) is generated, and the process terminates because the space is finite under the bias bounds.

`allow_recursion` controls whether the head predicates are added to the body's predicate set — when true, a clause may call the target recursively.

## language biases: connectivity and modes

Two restrictions prune the frontier *before* a candidate is ever coverage-tested. Both are standard ILP language biases, not heuristics: they exclude clauses that could never be the answer.

- **Connectivity (range-restriction).** Every body atom must share a variable, directly or transitively, with the head. A body literal disjoint from the head — `t(V0) :- e(V1, V1)` — can't constrain `V0`; it only acts as a global existence guard, which is never the rule being learned. Excluding it removes the cartesian blow-up of pairing every atom with every other. Connectivity is always on.
- **Mode-directedness.** When the bias declares modes (`mode: ["in", "out", ...]` on a predicate), a clause is kept only if its body admits a left-to-right order in which every atom's input arguments are already bound — the head's inputs seed the bound set, and each placed atom binds its variables. This is the same well-modedness the lowering requires (`analyze.js`), applied at enumeration time. It stops a high-arity predicate like `cell/4` from introducing a fresh variable in an *input* position: a value can only be born from an `out` position. A bias that declares no modes is treated as relational and feels only the connectivity bias.
- **Type consistency.** When predicates declare argument types (`arg_types: ["grid", "coord", ...]`), a variable may occupy only positions of a single type, and a typed constant only positions of its type. A variable that lands in a `colour` position and a `coord` position in the same clause is rejected. This is what stops the search from trying a colour where a coordinate belongs — the bulk of the wasted frontier for high-arity grid predicates. Untyped predicates are unconstrained.

All three are sound with respect to the restricted language: every connected, well-moded, type-consistent program is still generated. On the ARC `mirror_x` bias (`cell/4` + `mirror_x/3`, body length 2, 5 variables) connectivity and modes cut the single-clause frontier from ~281k candidates to ~108k, and adding types collapses it to ~114 — enough that the body-2 mirror rule, once out of reach, now synthesizes in tens of candidates.

## scope

The space is large by nature; this is the combinatorial cost ILP pays for guarantees. Path A targets small biases, where exhaustive enumeration with constraint pruning (#009) is competitive. Larger biases are the job of Path B (ASP via Clingo, #016), and batched evaluation on the GPU (#014) is what makes a wide frontier affordable.
