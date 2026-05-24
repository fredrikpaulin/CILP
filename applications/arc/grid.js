// Grid representation for the ARC application. A grid is a flat array of colour codes
// (0–9) with a width and height; cell (x, y) lives at cells[y * width + x].

export function gridFromRows(rows) {
  const height = rows.length
  const width = rows[0].length
  const cells = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) cells.push(rows[y][x])
  }
  return { width, height, cells }
}

export function at(g, x, y) {
  return g.cells[y * g.width + x]
}

export function* positions(g) {
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) yield [x, y]
  }
}

export function sameGrid(a, b) {
  return a.width === b.width && a.height === b.height && a.cells.every((c, i) => c === b.cells[i])
}

// 4-connected, same-colour components. Returns a component id per cell and the count.
export function components(g) {
  const key = (x, y) => y * g.width + x
  const id = new Array(g.cells.length).fill(-1)
  let next = 0
  for (const [x, y] of positions(g)) {
    if (id[key(x, y)] !== -1) continue
    const colour = at(g, x, y)
    const comp = next++
    const stack = [[x, y]]
    while (stack.length) {
      const [cx, cy] = stack.pop()
      if (cx < 0 || cy < 0 || cx >= g.width || cy >= g.height) continue
      if (id[key(cx, cy)] !== -1) continue
      if (at(g, cx, cy) !== colour) continue
      id[key(cx, cy)] = comp
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
  }
  return { id, count: next, key }
}
