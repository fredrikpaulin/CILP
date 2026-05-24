// A deliberately stale implementation: it records a hash that does not match its
// manifest, so loadHarness (and therefore the registry's load()) must reject it.

export const semantic_hash = "sha256:0000000000000000000000000000000000000000000000000000000000000000"

export const predicates = {
  yes: () => true
}
