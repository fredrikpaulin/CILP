"""Test driver for the Python lowering. Reads a spec file and either runs a lowered
entrypoint over given input terms (printing the yielded out-tuples as JSON) or runs
conformance for a curated library's Python implementation. Modules resolve via PYTHONPATH
(the runtime dir, the library dir, and the temp dir holding the lowered module)."""

import json
import sys
import importlib

spec = json.load(open(sys.argv[1]))

if spec["mode"] == "run":
    mod = importlib.import_module(spec["module"])
    fn = getattr(mod, spec["entry"])
    print(json.dumps([list(t) for t in fn(*spec["args"])]))
elif spec["mode"] == "conform":
    import copper_runtime
    impl = importlib.import_module(spec["impl"])
    manifest = json.load(open(spec["manifest"]))
    print(json.dumps(copper_runtime.conform(manifest, impl.predicates)))
