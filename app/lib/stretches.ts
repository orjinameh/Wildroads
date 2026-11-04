// Groups grid cells that touch each other (including diagonally) into road "stretches", and lists
// the links between touching cells so a stretch can be drawn as a connected line instead of dots.
// Pure and dependency-free so it can be unit-tested.

export type CellIndex = { a: number; b: number }; // integer grid coordinates of a cell
export type Group = { members: number[]; links: [number, number][] };

// Four "forward" neighbours cover all eight directions without listing a link twice.
const FORWARD: [number, number][] = [
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function groupCells(cells: CellIndex[]): Group[] {
  const at = new Map<string, number>();
  cells.forEach((c, i) => at.set(`${c.a}:${c.b}`, i));

  const parent = cells.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };

  const links: [number, number][] = [];
  cells.forEach((c, i) => {
    for (const [da, db] of FORWARD) {
      const j = at.get(`${c.a + da}:${c.b + db}`);
      if (j === undefined) continue;
      links.push([i, j]);
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[ri] = rj;
    }
  });

  const byRoot = new Map<number, Group>();
  cells.forEach((_, i) => {
    const r = find(i);
    const g = byRoot.get(r) ?? { members: [], links: [] };
    g.members.push(i);
    byRoot.set(r, g);
  });
  for (const [i, j] of links) byRoot.get(find(i))!.links.push([i, j]);
  return [...byRoot.values()];
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
