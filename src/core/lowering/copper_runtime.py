"""copper-ilp Python runtime — the term machinery the Python lowering target leans on.

Terms are the same JSON shape as the rest of Copper, here as plain dicts:
  {"type": "const", "value": ...}
  {"type": "var", "name": str, "id": int}
  {"type": "compound", "functor": str, "args": [term, ...]}

A substitution is a dict {var_id: term}. This is a faithful port of the JS core's
unification, walk, and background registry, so a Python-lowered program and the JSON
interpreter agree by construction. It is correct, small, and not performance-tuned.
"""

import inspect


def walk(term, sub):
    while term.get("type") == "var" and term["id"] in sub:
        term = sub[term["id"]]
    return term


def _occurs(vid, term, sub):
    t = walk(term, sub)
    if t.get("type") == "var":
        return t["id"] == vid
    if t.get("type") == "compound":
        return any(_occurs(vid, a, sub) for a in t["args"])
    return False


def unify(a, b, sub):
    if sub is None:
        return None
    a = walk(a, sub)
    b = walk(b, sub)
    if a.get("type") == "var" and b.get("type") == "var" and a["id"] == b["id"]:
        return sub
    if a.get("type") == "var":
        if _occurs(a["id"], b, sub):
            return None
        s = dict(sub)
        s[a["id"]] = b
        return s
    if b.get("type") == "var":
        if _occurs(b["id"], a, sub):
            return None
        s = dict(sub)
        s[b["id"]] = a
        return s
    if a.get("type") == "const" and b.get("type") == "const":
        return sub if a["value"] == b["value"] else None
    if a.get("type") == "compound" and b.get("type") == "compound":
        if a["functor"] != b["functor"] or len(a["args"]) != len(b["args"]):
            return None
        for x, y in zip(a["args"], b["args"]):
            sub = unify(x, y, sub)
            if sub is None:
                return None
        return sub
    return None


def apply_substitution(term, sub):
    t = walk(term, sub)
    if t.get("type") == "compound":
        return {"type": "compound", "functor": t["functor"], "args": [apply_substitution(a, sub) for a in t["args"]]}
    return t


def term_eq(a, b):
    # Structural equality, for an equality constraint a call's output must satisfy.
    if a.get("type") != b.get("type"):
        return False
    if a["type"] == "var":
        return a["id"] == b["id"]
    if a["type"] == "const":
        return a["value"] == b["value"]
    return a["functor"] == b["functor"] and len(a["args"]) == len(b["args"]) and all(term_eq(x, y) for x, y in zip(a["args"], b["args"]))


class _Registry:
    def __init__(self, predicates):
        self.predicates = predicates

    def has(self, name):
        return name in self.predicates

    def solve(self, name, args, sub):
        fn = self.predicates[name]
        if inspect.isgeneratorfunction(fn):
            yield from fn(args, sub)
            return
        result = fn(args, sub)
        # A plain function: True succeeds with no new bindings, a dict succeeds with those
        # bindings (an empty dict is success too — note it is falsy in Python), anything
        # else fails.
        if result is True:
            yield sub
        elif isinstance(result, dict):
            yield result


def make_registry(predicates):
    return _Registry(predicates)


# --- conformance -----------------------------------------------------------------------
# Mirrors copper-ilp/core conform(): run each manifest example call against the
# implementation and check the solutions match the declared result.

def _canonical(value):
    if isinstance(value, list):
        return [_canonical(v) for v in value]
    if isinstance(value, dict):
        return {k: _canonical(value[k]) for k in sorted(value)}
    return value


def _key(obj):
    import json
    return json.dumps(_canonical(obj), sort_keys=True)


def _normalize_call(call):
    # Assign first-appearance ids to the call's variables (the registry keys by id).
    ids = {}

    def assign(t):
        if t.get("type") == "var":
            if t["name"] not in ids:
                ids[t["name"]] = len(ids)
            return {"type": "var", "name": t["name"], "id": ids[t["name"]]}
        if t.get("type") == "compound":
            return {"type": "compound", "functor": t["functor"], "args": [assign(a) for a in t["args"]]}
        return t

    args = [assign(a) for a in call["args"]]
    return call["predicate"], args, ids


def _solutions(registry, call):
    pred, args, ids = _normalize_call(call)
    out = []
    for sub in registry.solve(pred, args, {}):
        binding = {}
        for name, vid in ids.items():
            binding[name] = apply_substitution({"type": "var", "name": name, "id": vid}, sub)
        out.append(binding)
    return out


def _matches(solutions, result):
    if result is None or result is True:
        return len(solutions) > 0
    if result is False:
        return len(solutions) == 0
    if isinstance(result, dict) and isinstance(result.get("solutions"), list):
        actual = sorted(_key(b) for b in solutions)
        expected = sorted(_key(b) for b in result["solutions"])
        return actual == expected
    return False


def conform(manifest, predicates):
    registry = make_registry(predicates)
    results = []
    untested = []
    for prim in manifest.get("primitives", []):
        examples = prim.get("examples", [])
        if not examples:
            untested.append(prim["name"])
            continue
        for ex in examples:
            try:
                ok = _matches(_solutions(registry, ex["call"]), ex.get("result"))
                results.append({"primitive": prim["name"], "conforms": ok})
            except Exception as e:  # noqa: BLE001 - report, don't crash
                results.append({"primitive": prim["name"], "conforms": False, "error": str(e)})
    return {"conforms": all(r["conforms"] for r in results), "results": results, "untested": untested}
