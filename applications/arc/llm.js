// Wires the ARC application to the LLM-bias proposer (C3). The catalog is what the
// model chooses from — a name, arity, and one-line meaning per predicate, which is
// also the seed of a harness manifest (#023). solveTaskWithProposer is the hybrid
// loop end to end: the model scopes the bias from the task description and examples,
// the bias is validated, and Copper searches inside it.

import { llmBiasProposer } from "../../src/engine/bias.js"
import { solveTask } from "./task.js"

const renderGrid = rows => rows.map(r => r.join("")).join("\n")

// Render a task's train pairs to text for the prompt.
export function describeTask(task) {
  return task.train
    .map((p, i) => `pair ${i}:\ninput:\n${renderGrid(p.input)}\noutput:\n${renderGrid(p.output)}`)
    .join("\n\n")
}

export const ARC_CATALOG = [
  { name: "cell", arity: 4, description: "cell(G,X,Y,C): input grid G has colour C at column X, row Y" },
  { name: "adjacent", arity: 5, description: "adjacent(G,X1,Y1,X2,Y2): the two cells are 4-connected neighbours" },
  { name: "adjacent8", arity: 5, description: "adjacent8(G,X1,Y1,X2,Y2): 8-connected neighbours, including diagonals" },
  { name: "same_color", arity: 5, description: "same_color(G,X1,Y1,X2,Y2): the two cells share a colour" },
  { name: "mirror_x", arity: 3, description: "mirror_x(G,X,X2): X2 is the horizontal mirror of column X (width-1-X)" },
  { name: "mirror_y", arity: 3, description: "mirror_y(G,Y,Y2): Y2 is the vertical mirror of row Y (height-1-Y)" },
  { name: "width", arity: 2, description: "width(G,W): grid G is W columns wide" },
  { name: "height", arity: 2, description: "height(G,H): grid G is H rows tall" },
  { name: "inside", arity: 3, description: "inside(G,X,Y): (X,Y) is within grid G's bounds" },
  { name: "count_of", arity: 3, description: "count_of(G,C,N): colour C appears N times in grid G" },
  { name: "component", arity: 4, description: "component(G,X,Y,Id): cell (X,Y) belongs to connected same-colour region Id" },
  { name: "bounding_box", arity: 6, description: "bounding_box(G,Id,X1,Y1,X2,Y2): region Id spans (X1,Y1) to (X2,Y2)" },
  { name: "is_color", arity: 1, description: "is_color(C): C is a colour 0-9" }
]

const HEAD_HINT = "output/4 — output(G,X,Y,C): output grid G has colour C at column X, row Y"

export function arcProposer(callModel) {
  return llmBiasProposer({ callModel, catalog: ARC_CATALOG, headHint: HEAD_HINT })
}

// The hybrid loop: model scopes the bias, Copper searches inside it.
export async function solveTaskWithProposer(task, callModel, options = {}) {
  const propose = arcProposer(callModel)
  const bias = await propose(options.description ?? task.name, describeTask(task))
  const solution = await solveTask(task, bias, options)
  return { bias, ...solution }
}
