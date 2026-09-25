export interface TileCoord {
  x: number;
  y: number;
}

const NEIGHBORS: TileCoord[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/** 4-direction BFS on foot tiles; respects MapGrid 1x2 character footprint. */
export function findTilePath(
  start: TileCoord,
  goal: TileCoord,
  canEnter: (x: number, footTileY: number) => boolean
): TileCoord[] | null {
  if (start.x === goal.x && start.y === goal.y) {
    return [];
  }
  if (!canEnter(goal.x, goal.y)) {
    return null;
  }

  const startKey = key(start.x, start.y);
  const goalKey = key(goal.x, goal.y);
  const queue: TileCoord[] = [start];
  const cameFrom = new Map<string, string>();
  cameFrom.set(startKey, startKey);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const ck = key(current.x, current.y);
    if (ck === goalKey) {
      const path: TileCoord[] = [];
      let cur = goalKey;
      while (cur !== startKey) {
        const [x, y] = cur.split(',').map(Number);
        path.push({ x, y });
        const prev = cameFrom.get(cur);
        if (!prev) break;
        cur = prev;
      }
      path.reverse();
      return path;
    }

    for (const d of NEIGHBORS) {
      const nx = current.x + d.x;
      const ny = current.y + d.y;
      const nk = key(nx, ny);
      if (cameFrom.has(nk)) continue;
      if (!canEnter(nx, ny)) continue;
      cameFrom.set(nk, ck);
      queue.push({ x: nx, y: ny });
    }
  }

  return null;
}
