"""Python implementation of the `lists` manifest, v1.0.0.

Lists are cons/nil compound terms, the same representation as the JavaScript
implementation, so both targets agree on the manifest's example calls. The predicates have
the same shape as the JS ones: a plain function returns True / a substitution dict / False,
and a generator yields a substitution per solution.

A real implementation also records the manifest hash it targets; the tests check it the
same way they check the JS implementation.
"""

from copper_runtime import unify, walk

semantic_hash = "sha256:77dd2ac8d319b9de0fa251fcd66acc08d19be0ed4f6272248d25c54984ebf886"


def _cons(h, t):
    return {"type": "compound", "functor": "cons", "args": [h, t]}


def _is_cons(t):
    return t.get("type") == "compound" and t.get("functor") == "cons" and len(t["args"]) == 2


def _is_nil(t):
    return t.get("type") == "compound" and t.get("functor") == "nil" and len(t["args"]) == 0


def cons(args, sub):
    # An empty substitution is a *successful* unification with no new bindings, so we must
    # distinguish None (failure) from {} (success) — `or False` would wrongly drop {}.
    s = unify(args[2], _cons(args[0], args[1]), sub)
    return False if s is None else s


def head(args, sub):
    lst = walk(args[0], sub)
    if not _is_cons(lst):
        return False
    s = unify(args[1], lst["args"][0], sub)
    return False if s is None else s


def tail(args, sub):
    lst = walk(args[0], sub)
    if not _is_cons(lst):
        return False
    s = unify(args[1], lst["args"][1], sub)
    return False if s is None else s


def empty(args, sub):
    return _is_nil(walk(args[0], sub))


def member(args, sub):
    lst = walk(args[1], sub)
    while _is_cons(lst):
        s = unify(args[0], lst["args"][0], sub)
        if s is not None:
            yield s
        lst = walk(lst["args"][1], sub)


predicates = {"cons": cons, "head": head, "tail": tail, "empty": empty, "member": member}
