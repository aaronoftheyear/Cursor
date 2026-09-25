export interface MapGridData {
  width: number;
  height: number;
  tileSize: number;
  blocked: number[];
  overhead: number[];
}

export class MapGrid {
  constructor(private data: MapGridData) {}

  static async load(path: string): Promise<MapGrid | null> {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const data = (await res.json()) as MapGridData;
      return new MapGrid(data);
    } catch {
      return null;
    }
  }

  isBlocked(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= this.data.width || tileY >= this.data.height) {
      return true;
    }
    return this.data.blocked[tileY * this.data.width + tileX] === 1;
  }

  /** Foot tile only — avoids false blocks when walls/mid sit beside narrow aisles. */
  isBlockedForFootprint(tileXs: number[], footTileY: number): boolean {
    for (const tileX of tileXs) {
      if (this.isBlocked(tileX, footTileY)) {
        return true;
      }
    }
    return false;
  }

  isOverhead(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileY < 0 || tileX >= this.data.width || tileY >= this.data.height) {
      return false;
    }
    return this.data.overhead[tileY * this.data.width + tileX] === 1;
  }

  get width(): number {
    return this.data.width;
  }

  get height(): number {
    return this.data.height;
  }
}
