import type { Room } from './map';
import type { AgentRole } from './types';

export interface MapActionTile {
  x: number;
  y: number;
  gid: number;
  gidRaw?: number;
  localTileId?: number;
  /** Human-readable marker type derived from the action tile graphic (gid). */
  kind?: string;
}

export interface MapActionsData {
  width: number;
  height: number;
  tileSize: number;
  /** Tiled layer name (e.g. Actions). Never rendered — work-position markers only. */
  layer: string;
  tiles: MapActionTile[];
}

/** Distinct action marker graphics in your map (6 types). */
/** Matches the pixel icon in Interior general (see public/assets/maps/action-markers-legend.png). */
export const ACTION_MARKER_KIND: Record<number, string> = {
  4240: 'clipboard',
  4200: 'meal_rice',
  4208: 'laptop_center',
  4216: 'meal_plate',
  4234: 'laptop_left',
  4233: 'laptop_right',
  4053: 'book',
  3438: 'terminal',
  3439: 'automation',
  3447: 'monitor',
  6581: 'workbench',
  6590: 'spawn_pad',
};

export function describeActionTile(tile: MapActionTile): string {
  const kind = ACTION_MARKER_KIND[tile.gid] ?? `unknown_gid_${tile.gid}`;
  return `${kind} @ (${tile.x},${tile.y}) gid=${tile.gid}`;
}

function tileInsideRoom(tile: MapActionTile, room: Room): boolean {
  return (
    tile.x >= room.x &&
    tile.x < room.x + room.width &&
    tile.y > room.y &&
    tile.y < room.y + room.height
  );
}

function preferredGidsForRole(role: AgentRole): number[] {
  switch (role) {
    case 'coordinator':
      return [4240, 4234, 4233, 4053];
    case 'subagent':
      return [4234, 4233, 4053, 4216, 4200];
    default:
      return [4053, 4234, 4233, 4240, 4200, 4216];
  }
}

/** Invisible action markers from Tiled — where an agent stands while working. */
export class ActionSpots {
  private byRoom = new Map<string, MapActionTile[]>();

  constructor(data: MapActionsData, rooms: Room[]) {
    for (const tile of data.tiles) {
      tile.kind = ACTION_MARKER_KIND[tile.gid] ?? `gid_${tile.gid}`;
    }
    for (const room of rooms) {
      const tiles = data.tiles.filter((t) => tileInsideRoom(t, room));
      tiles.sort((a, b) => a.y - b.y || a.x - b.x);
      this.byRoom.set(room.id, tiles);
    }
  }

  getSpotsForRoom(roomId: string): MapActionTile[] {
    return this.byRoom.get(roomId) ?? [];
  }

  getSpotsByKind(roomId: string): Map<string, MapActionTile[]> {
    const grouped = new Map<string, MapActionTile[]>();
    for (const tile of this.getSpotsForRoom(roomId)) {
      const kind = tile.kind ?? 'unknown';
      const list = grouped.get(kind) ?? [];
      list.push(tile);
      grouped.set(kind, list);
    }
    return grouped;
  }

  /** Role-aware desk pick; falls back if that graphic is not in the room. */
  getSpotForAgent(agentId: string, roomId: string, role: AgentRole): MapActionTile | null {
    const roomTiles = this.getSpotsForRoom(roomId);
    if (roomTiles.length === 0) return null;

    const preferred = preferredGidsForRole(role);
    let pool = roomTiles.filter((t) => preferred.includes(t.gid));
    if (pool.length === 0) pool = roomTiles;

    let hash = 0;
    for (let i = 0; i < agentId.length; i++) {
      hash = (hash + agentId.charCodeAt(i)) | 0;
    }
    return pool[Math.abs(hash) % pool.length];
  }
}
