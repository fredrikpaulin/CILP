# Hypothesis enumeration

The Path A enumerator (`enumerate`) generates candidate programs that fit a bias, lazily and in order of increasing complexity. It is the default source of candidates for `synthesize`; the search loop pulls programs from it and tests each with the coverage harness.

## the hypothesis space

A candidate is a `Program` of one or more clauses. The enumerator works over a restricted, well-defined space:

- **Variable-only clauses.** Atom arguments are variables, never constants. Constants enter a problem through the examples and the background predicates, not through the clause structure. This is the standard datalog-style hypothesis representation and is what the bias bounds (`max_variables`) describe.
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

## scope

The space is large by nature; this is the combinatorial cost ILP pays for guarantees. Path A targets small biases, where exhaustive enumeration with constraint pruning (#009) is competitive. Larger biases are the job of Path B (ASP via Clingo, #016), and batched evaluation on the GPU (#014) is what makes a wide frontier affordable.
