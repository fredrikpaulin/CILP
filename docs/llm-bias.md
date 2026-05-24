# LLM-assisted bias

The hardest part of using an ILP system is writing the bias — choosing which background predicates the search may use and how large a program to allow. Too broad and the search never finishes; too narrow and the rule isn't in the space. This is a fuzzy, contextual judgment, which is what an LLM is good at; the rigorous search inside the bias is what the LLM is bad at and Copper is good at. So the LLM scopes the search and Copper performs it. The LLM never writes the program — it only narrows where Copper looks.

## the contract

The model is injected as `callModel(prompt) => Promise<string>`, so the engine has no LLM dependency. What the engine owns and tests is the contract around the model:

```js
import { llmBiasProposer } from "copper-ilp/engine"

const propose = llmBiasProposer({ callModel, catalog, headHint })
const bias = await propose(description, examples)   // validated against the bias schema
```

`buildBiasPrompt` shows the model the task, the predicate catalog (each predicate's name, arity, and one-line meaning), and the exact JSON shape to return. `parseBiasResponse` pulls a JSON bias out of the reply, whether it's fenced in `​```json`, raw, or wrapped in prose. And `llmBiasProposer` **validates the proposed bias against the bias schema before returning it** — a malformed or hallucinated bias fails loudly at the boundary rather than corrupting the search. Tests drive all of this with a mock `callModel`; wiring a real model (Anthropic, OpenAI, a local model) is one function the caller supplies.

The predicate catalog is the same information a harness manifest carries (#023), so this and the manifest work converge.

## why scoping is the win

The value is measurable and it is *search efficiency*, not cleverness. The ARC predicate library has predicates of arity up to 6; a body atom over `n` variables is `nᵃ` candidates, so an irrelevant high-arity predicate floods the frontier. Synthesizing the identity transform with a bias scoped to `[cell]` tests a couple of hundred candidates; with a broad bias that also includes `adjacent/5` (1024 useless body atoms), Copper still finds the same rule but tests roughly five times as many candidates first. That ratio grows with the size of the irrelevant set and with body length — which is exactly the regime where a good bias is the difference between seconds and never. The LLM's job is to keep that irrelevant set out.

## honest scope

This is the *pattern* — LLM scopes, Copper searches, the bias is validated — demonstrated end to end on the ARC application with a mock model. The real model call is the caller's to wire, and the harder, open question the architecture flags (can a current LLM reliably recognize a synthesizable task and propose a good bias?) is an empirical study, not something this code settles. What's built is the seam: a validated, schema-checked bias produced from a description and examples, feeding a search that is rigorous by construction.
