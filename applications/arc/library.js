// The ARC background-predicate library. Each predicate describes the input grids and
// is parameterized by a grid id G, so one synthesized rule applies across every
// train pair (and the test grid). Predicates are relations over precomputed tuples —
// the same "facts over a JS array" shape the executor's background registry expects.
//
// This is the broad library: cells, adjacency (4- and 8-connected), colour equality,
// mirror positions, dimensions, bounds, colour counts, connected components, and
// bounding boxes. The path to the architecture's ~40 predicates (rotations, per-axis
// symmetry, neighbour colour, object size ordering) is more of the same shape.

import { unify } from "../../src/core/unify.js"
import { makeRegistry } from "../../src/core/background.js"
import { at, positions, components } from "./grid.js"

const C = value => ({ type: "const", value })

// Wrap a list of tuples as a non-deterministic background predicate: it yields a
// substitution for every tuple that unifies with the goal's arguments.
function relation(tuples) {
  return function* (args, sub) {
    for (const t of tuples) {
      let s = sub
      for (let i = 0; i < t.length; i++) {
        s = unify(args[i], C(t[i]), s)
        if (s === null) break
      }
      if (s !== null) yield s
    }
  }
}

// `grids` maps a grid id to a grid. Predicate arities:
//   cell/4 adjacent/5 adjacent8/5 same_color/5 mirror_x/3 mirror_y/3
//   width/2 height/2 inside/3 count_of/3 component/4 bounding_box/6 is_color/1
export const ARITY = {
  output: 4,
  cell: 4, adjacent: 5, adjacent8: 5, same_color: 5, mirror_x: 3, mirror_y: 3,
  width: 2, height: 2, inside: 3, count_of: 3, component: 4, bounding_box: 6, is_color: 1
}

// Argument types per position, for the type-directed enumerator (#045). Coordinates share a
// single "coord" type so a transform can swap x and y (transpose is cell(G,Y,X,C)); colours,
// grid ids, component ids, and counts are distinct. Typing is what stops the search from
// trying a colour variable in a coordinate slot — the bulk of the wasted ARC frontier.
export const TYPES = {
  output: ["grid", "coord", "coord", "colour"],
  cell: ["grid", "coord", "coord", "colour"],
  adjacent: ["grid", "coord", "coord", "coord", "coord"],
  adjacent8: ["grid", "coord", "coord", "coord", "coord"],
  same_color: ["grid", "coord", "coord", "coord", "coord"],
  mirror_x: ["grid", "coord", "coord"],
  mirror_y: ["grid", "coord", "coord"],
  width: ["grid", "coord"],
  height: ["grid", "coord"],
  inside: ["grid", "coord", "coord"],
  count_of: ["grid", "colour", "count"],
  component: ["grid", "coord", "coord", "comp"],
  bounding_box: ["grid", "comp", "coord", "coord", "coord", "coord"],
  is_color: ["colour"]
}

// Functional direction of each predicate: a grid id and coordinates are inputs, the derived
// value is the output. The head `output/4` is all-input — every ARC example is a ground
// output cell, so the rule is a check, not a producer. These modes are what lets the
// mode-directed enumerator (#044) keep a fresh variable out of an input position: a column's
// mirror can only be born from mirror_x's output, not invented inside cell's coordinate slot.
export const MODES = {
  output: ["in", "in", "in", "in"],
  cell: ["in", "in", "in", "out"],
  adjacent: ["in", "in", "in", "out", "out"],
  adjacent8: ["in", "in", "in", "out", "out"],
  same_color: ["in", "in", "in", "out", "out"],
  mirror_x: ["in", "in", "out"],
  mirror_y: ["in", "in", "out"],
  width: ["in", "out"],
  height: ["in", "out"],
  inside: ["in", "in", "in"],
  count_of: ["in", "in", "out"],
  component: ["in", "in", "in", "out"],
  bounding_box: ["in", "in", "out", "out", "out", "out"],
  is_color: ["in"]
}

export function arcBackground(grids) {
  const cell = [], adjacent = [], adjacent8 = [], same_color = []
  const mirror_x = [], mirror_y = [], width = [], height = [], inside = []
  const count_of = [], component = [], bounding_box = []

  for (const [gid, g] of Object.entries(grids)) {
    width.push([gid, g.width])
    height.push([gid, g.height])
    for (let x = 0; x < g.width; x++) mirror_x.push([gid, x, g.width - 1 - x])
    for (let y = 0; y < g.height; y++) mirror_y.push([gid, y, g.height - 1 - y])

    const cells = [...positions(g)]
    for (const [x, y] of cells) {
      cell.push([gid, x, y, at(g, x, y)])
      inside.push([gid, x, y])
      const n4 = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      const diag = [[x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]]
      for (const [nx, ny] of n4) {
        if (nx >= 0 && ny >= 0 && nx < g.width && ny < g.height) adjacent.push([gid, x, y, nx, ny])
      }
      for (const [nx, ny] of [...n4, ...diag]) {
        if (nx >= 0 && ny >= 0 && nx < g.width && ny < g.height) adjacent8.push([gid, x, y, nx, ny])
      }
    }

    for (const [x1, y1] of cells) {
      for (const [x2, y2] of cells) {
        if ((x1 !== x2 || y1 !== y2) && at(g, x1, y1) === at(g, x2, y2)) {
          same_color.push([gid, x1, y1, x2, y2])
        }
      }
    }

    const counts = new Map()
    for (const [x, y] of cells) counts.set(at(g, x, y), (counts.get(at(g, x, y)) || 0) + 1)
    for (const [c, n] of counts) count_of.push([gid, c, n])

    const comp = components(g)
    const boxes = new Map()
    for (const [x, y] of cells) {
      const cid = comp.id[comp.key(x, y)]
      component.push([gid, x, y, cid])
      const b = boxes.get(cid) || { minx: x, miny: y, maxx: x, maxy: y }
      b.minx = Math.min(b.minx, x); b.miny = Math.min(b.miny, y)
      b.maxx = Math.max(b.maxx, x); b.maxy = Math.max(b.maxy, y)
      boxes.set(cid, b)
    }
    for (const [cid, b] of boxes) bounding_box.push([gid, cid, b.minx, b.miny, b.maxx, b.maxy])
  }

  const is_color = []
  for (let c = 0; c < 10; c++) is_color.push([c])

  return makeRegistry({
    cell: relation(cell),
    adjacent: relation(adjacent),
    adjacent8: relation(adjacent8),
    same_color: relation(same_color),
    mirror_x: relation(mirror_x),
    mirror_y: relation(mirror_y),
    width: relation(width),
    height: relation(height),
    inside: relation(inside),
    count_of: relation(count_of),
    component: relation(component),
    bounding_box: relation(bounding_box),
    is_color: relation(is_color)
  })
}
