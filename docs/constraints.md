# Constraint learning

The enumerator is complete but enormous. The constraint learner is what makes the search tractable: when a candidate fails, it derives a constraint explaining *why*, and uses that constraint to prune related candidates without ever testing them. `synthesize` enables it by default; pass `{ constraints: false }` to turn it off (useful for measuring its effect).

## the four constraints

**`too_general(H)`** — derived when `H` covers more negatives than `noise_tolerance` allows. Adding clauses to a program is monotonic — it can only add coverage — so any *clause-superset* of `H` also over-covers. The learner prunes every later candidate whose clause set contains all of `H`'s clauses.

**`too_specific(C)`** — derived when a single-clause candidate `C` fails to cover a positive. Adding body literals only makes a clause more specific, so no specialization of `C` recovers the positive. The learner prunes single-clause candidates that `C` theta-subsumes (more body literals over a renaming of `C`).

**`unsatisfiable(C)`** — a clause that can never be satisfied for structural reasons. Copper detects the type-conflict case: a variable required to hold two different types across the predicate positions it occupies. Any program containing such a clause is pruned. With no type declarations in the bias, this never fires; richer logical unsatisfiability is left to Path B's ASP encoding.

**`redundant(H1, H2)`** — two programs equal up to variable renaming and clause reordering. The learner canonicalizes each candidate and prunes any whose canonical form has already been tested.

## canonical form

Pruning has to be renaming-invariant: `t(V0) :- e(V0, V1)` and `t(V0) :- e(V0, V2)` are the same clause. `canonicalClause` renders a clause to a canonical string — head variables stay fixed (they map to example argument positions, so renaming them would change meaning), body-only variables are renamed to the lexicographically smallest order, and body atoms are sorted. `canonicalProgram` sorts the canonical clauses, so clause order doesn't matter either. Equal canonical strings mean equal programs.

## soundness

Every constraint is sound: a pruned candidate provably cannot be a solution that a simpler or already-tested candidate isn't. `too_general` relies on the monotonicity of definite programs; `too_specific` on the monotonicity of clause bodies; `unsatisfiable` on type disjointness; `redundant` on the renaming-invariance of coverage. The matching is renaming-invariant via canonical forms, and `too_specific`'s theta-subsumption is complete for these clauses because variable counts are bounded by the bias.

## what's deferred

`too_general` and `too_specific` prune in the directions that matter for the enumeration order (clause-supersets and body-supersets, which come later). Full subsumption-based pruning across both the clause and body dimensions, and unsatisfiability beyond type conflicts, are refinements that land with Path B (#016) and the GPU constraint-mask kernel (#014), which computes prune masks over a whole candidate frontier at once.
