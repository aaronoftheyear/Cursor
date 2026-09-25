/**
 * Spawn guard logic - finds valid spawn positions for agents.
 * Extracted from engine.ts for testability.
 */

export interface TileCoord {
  x: number;
  y: number;
}

export interface Room {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CollisionMap {
  width: number;
  height: number;
  blocked: number[];
}

/**
 * Check if a tile is blocked in the collision map.
 * Also blocks out-of-bounds coordinates.
 */
export function isBlocked(map: CollisionMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  return map.blocked[y * map.width + x] === 1;
}

/**
 * Get all walkable tiles within a room.
 * Excludes the top row of the room (y === room.y) as that's typically walls.
 */
export function getWalkableTilesInRoom(
  map: CollisionMap,
  room: Room
): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let y = room.y + 1; y < room.y + room.height; y++) {
    for (let x = room.x; x < room.x + room.width; x++) {
      if (!isBlocked(map, x, y)) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

/**
 * Get all walkable tiles in the entire map.
 */
export function getAllWalkableTiles(map: CollisionMap): TileCoord[] {
  const tiles: TileCoord[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isBlocked(map, x, y)) {
        tiles.push({ x, y });
      }
    }
  }
  return tiles;
}

/**
 * Resolve spawn tile for an agent without a defined spawn point.
 * 
 * Rules:
 * 1. Prefer walkable tiles in the agent's own room
 * 2. Fall back to any walkable tile in the map
 * 3. Never return a blocked tile
 * 4. Never return the bottom row (reserved for map edge)
 * 
 * @param map - The collision map
 * @param room - The agent's assigned room (or null for global)
 * @param bottomRow - The row number that should never be used (typically map.height - 1)
 * @returns A random walkable tile, or null if none available
 */
export function resolveNoSpawnTile(
  map: CollisionMap,
  room: Room | null,
  bottomRow: number
): TileCoord | null {
  // Get candidates from room first, then fallback to all tiles
  let candidates: TileCoord[];
  if (room) {
    candidates = getWalkableTilesInRoom(map, room);
    if (candidates.length === 0) {
      candidates = getAllWalkableTiles(map);
    }
  } else {
    candidates = getAllWalkableTiles(map);
  }
  
  candidates = filterOutBottomRow(candidates, bottomRow);
  
  if (candidates.length === 0) return null;
  
  // Return random tile
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx];
}

/**
 * Validate a spawn position - used for testing.
 */
/** Exclude map bottom row from spawn candidate tiles. */
export function filterOutBottomRow(
  candidates: TileCoord[],
  bottomRow: number
): TileCoord[] {
  return candidates.filter((t) => t.y !== bottomRow);
}

/**
 * Engine spawn path when an agent has no preferred spawn tile.
 * Mirrors GameEngine.resolveSpawnFootTile (collision + fallback walkables).
 */
export function pickEngineSpawnFootTile(
  map: CollisionMap,
  room: Room | null,
  walkableFallback: TileCoord[],
  bottomRow: number
): TileCoord | null {
  const fromResolver = resolveNoSpawnTile(map, room, bottomRow);
  if (fromResolver) return fromResolver;
  const filtered = filterOutBottomRow(walkableFallback, bottomRow);
  if (filtered.length === 0) return null;
  const idx = Math.floor(Math.random() * filtered.length);
  return filtered[idx];
}

export function isValidSpawnPosition(
  map: CollisionMap,
  tile: TileCoord,
  bottomRow: number
): { valid: boolean; reason?: string } {
  if (isBlocked(map, tile.x, tile.y)) {
    return { valid: false, reason: `Tile (${tile.x}, ${tile.y}) is blocked` };
  }
  if (tile.y === bottomRow) {
    return { valid: false, reason: `Tile (${tile.x}, ${tile.y}) is on bottom row ${bottomRow}` };
  }
  return { valid: true };
}
