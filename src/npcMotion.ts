import type { TileCoord } from './pathfind';

/** Pokémon-style NPC pacing: short walks, pauses, occasional look-around. */
export const NPC_PAUSE_MS_MIN = 2_200;
export const NPC_PAUSE_MS_MAX = 5_800;
export const NPC_LOOK_AROUND_CHANCE = 0.24;
export const NPC_WALK_TILES_MIN = 1;
export const NPC_WALK_TILES_MAX = 3;
export const NPC_INITIAL_DELAY_MAX_MS = 2_500;

const DIRECTIONS: TileCoord[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

export function randomNpcPauseMs(): number {
  return NPC_PAUSE_MS_MIN + Math.random() * (NPC_PAUSE_MS_MAX - NPC_PAUSE_MS_MIN);
}

export function manhattan(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Nearby foot tiles for a 1–3 step wander (GBA NPC style). */
export function pickShortWalkGoal(
  start: TileCoord,
  walkable: TileCoord[],
  minSteps = NPC_WALK_TILES_MIN,
  maxSteps = NPC_WALK_TILES_MAX
): TileCoord | null {
  const candidates = walkable.filter((t) => {
    if (t.x === start.x && t.y === start.y) return false;
    const d = manhattan(start, t);
    return d >= minSteps && d <= maxSteps;
  });
  if (candidates.length === 0) {
    const near = walkable.filter(
      (t) => !(t.x === start.x && t.y === start.y) && manhattan(start, t) === 1
    );
    if (near.length === 0) return null;
    return near[Math.floor(Math.random() * near.length)];
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function randomLookDirection(): 'left' | 'right' | 'up' | 'down' {
  const dirs = ['up', 'down', 'left', 'right'] as const;
  return dirs[Math.floor(Math.random() * dirs.length)];
}

export function truncatePath(path: TileCoord[], maxSteps: number): TileCoord[] {
  if (path.length <= maxSteps) return path;
  return path.slice(0, maxSteps);
}

export { DIRECTIONS };
