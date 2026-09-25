/**
 * Render queue building and sorting for depth-sorted 2.5D rendering.
 *
 * Layer ordering (Tiled layer → render constant):
 *   grass/floor    → background (baked, not in queue)
 *   furniture-low  → LAYER_WALKOVER - walkable, under avatar
 *   walls          → collision only (baked, not in queue)
 *   furniture-mid  → LAYER_MID - collision, depth sorted with avatar
 *   avatar         → LAYER_AGENT - depth sorted
 *   wall-front     → LAYER_WALLS_FRONT - collision, always on top of avatar
 *   furniture-high → overlay (drawn after queue, not in queue)
 *
 * Shadows are drawn in a SEPARATE PASS before the depth-sorted queue,
 * so they are ALWAYS under furniture-mid and wall-front regardless of Y.
 * Shadows sit on top of floor/grass/furniture-low only.
 *
 * Depth sorting: items at lower Y (higher on screen) draw first (behind).
 * At same Y, lower layer order draws first (underneath).
 */

export const LAYER_WALKOVER = 0;
export const LAYER_MID = 10;
export const LAYER_AGENT = 20;
export const LAYER_WALLS_FRONT = 30;

export interface RenderItem {
  sortY: number;
  layer: number;
  draw: () => void;
}

export interface TileCoord {
  x: number;
  y: number;
}

export interface AgentRenderInfo {
  id: string;
  feetY: number;
  drawShadow: () => void;
  drawAgent: () => void;
}

export interface TileRenderInfo {
  coord: TileCoord;
  sortY: number;
  draw: () => void;
}

/**
 * Build the depth-sorted render queue from agents and tiles.
 * Does NOT include shadows - those are drawn in a separate pass.
 */
export function buildRenderQueue(
  agents: AgentRenderInfo[],
  walkoverTiles: TileRenderInfo[],
  midTiles: TileRenderInfo[],
  wallsFrontTiles: TileRenderInfo[]
): RenderItem[] {
  const queue: RenderItem[] = [];

  for (const agent of agents) {
    queue.push({
      sortY: agent.feetY,
      layer: LAYER_AGENT,
      draw: agent.drawAgent,
    });
  }

  for (const tile of walkoverTiles) {
    queue.push({
      sortY: tile.sortY,
      layer: LAYER_WALKOVER,
      draw: tile.draw,
    });
  }

  for (const tile of midTiles) {
    queue.push({
      sortY: tile.sortY,
      layer: LAYER_MID,
      draw: tile.draw,
    });
  }

  for (const tile of wallsFrontTiles) {
    queue.push({
      sortY: tile.sortY,
      layer: LAYER_WALLS_FRONT,
      draw: tile.draw,
    });
  }

  return queue;
}

/**
 * Sort the render queue for correct depth ordering.
 * Lower sortY = higher on screen = drawn first (behind).
 * At same sortY, lower layer = drawn first (underneath).
 */
export function sortRenderQueue(queue: RenderItem[]): RenderItem[] {
  return queue.sort((a, b) =>
    a.sortY !== b.sortY ? a.sortY - b.sortY : a.layer - b.layer
  );
}

/**
 * Build and sort the render queue in one call.
 */
export function buildSortedRenderQueue(
  agents: AgentRenderInfo[],
  walkoverTiles: TileRenderInfo[],
  midTiles: TileRenderInfo[],
  wallsFrontTiles: TileRenderInfo[]
): RenderItem[] {
  const queue = buildRenderQueue(agents, walkoverTiles, midTiles, wallsFrontTiles);
  return sortRenderQueue(queue);
}
