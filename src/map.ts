// Map and room system for multi-area HQ

export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  agents: string[];
  door?: { x: number; y: number; direction: string };
  isOutdoor?: boolean;
}

export interface MapData {
  name: string;
  width: number;
  height: number;
  tileSize: number;
  rooms: Room[];
  connections: Array<{ from: string; to: string; doorX: number; doorY: number }>;
  spawnPoints: Record<string, { room: string; x: number; y: number }>;
  furniture: Record<string, Array<{ type: string; x: number; y: number }>>;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class GameMap {
  private data: MapData;
  private scale: number = 16; // pixels per tile
  
  constructor(data: MapData) {
    this.data = data;
  }
  
  getRoom(roomId: string): Room | undefined {
    return this.data.rooms.find(r => r.id === roomId);
  }
  
  getRoomForAgent(agentId: string): Room | undefined {
    return this.data.rooms.find(r => r.agents.includes(agentId));
  }
  
  /** Foot-tile spawn coordinates (same units as Tiled / hq.json spawnPoints). */
  getAgentSpawnTile(agentId: string): { x: number; y: number } | undefined {
    const spawn = this.data.spawnPoints[agentId];
    if (!spawn) return undefined;
    return { x: spawn.x, y: spawn.y };
  }

  /** @deprecated Use getAgentSpawnTile — kept for callers expecting pixel coords. */
  getAgentSpawnPoint(agentId: string): { x: number; y: number } | undefined {
    const tile = this.getAgentSpawnTile(agentId);
    if (!tile) return undefined;
    return { x: tile.x * this.scale, y: tile.y * this.scale };
  }
  
  getRoomBounds(roomId: string): Bounds | undefined {
    const room = this.getRoom(roomId);
    if (!room) return undefined;
    
    const padding = 32; // Keep agents away from walls
    
    return {
      minX: room.x * this.scale + padding,
      minY: room.y * this.scale + padding,
      maxX: (room.x + room.width) * this.scale - padding,
      maxY: (room.y + room.height) * this.scale - padding,
    };
  }
  
  getAgentBounds(agentId: string): Bounds | undefined {
    const room = this.getRoomForAgent(agentId);
    if (!room) return undefined;
    return this.getRoomBounds(room.id);
  }
  
  getAllRooms(): Room[] {
    return this.data.rooms;
  }
  
  getFurniture(roomId: string): Array<{ type: string; x: number; y: number }> {
    return this.data.furniture[roomId] || [];
  }
  
  getMapDimensions(): { width: number; height: number } {
    return {
      width: this.data.width * this.scale,
      height: this.data.height * this.scale,
    };
  }
  
  getTileSize(): number {
    return this.scale;
  }
  
  setScale(scale: number): void {
    this.scale = scale;
  }

  applyBakedDimensions(widthTiles: number, heightTiles: number, tileSize: number): void {
    this.data.width = widthTiles;
    this.data.height = heightTiles;
    this.scale = tileSize;
  }

  replaceData(data: MapData): void {
    this.data = data;
    this.scale = data.tileSize;
  }
}

export async function loadMapData(path: string): Promise<MapData | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as MapData;
  } catch {
    return null;
  }
}

// Default map data (used before custom map is loaded)
export const DEFAULT_MAP: MapData = {
  name: "AI Agent HQ",
  width: 30,
  height: 20,
  tileSize: 16,

  rooms: [
    {
      id: "cursor-room",
      name: "Cursor HQ",
      x: 2,
      y: 2,
      width: 10,
      height: 11,
      color: "#0066ff",
      agents: ["jarvis", "friday", "cursor", "cursor-grunt", "bumblebee"],
    },
    {
      id: "claude-room",
      name: "Claude HQ",
      x: 19,
      y: 2,
      width: 9,
      height: 11,
      color: "#d97706",
      agents: ["claude", "claude-code", "claude-cowork"],
    },
    {
      id: "main-space",
      name: "Main Space",
      x: 0,
      y: 14,
      width: 30,
      height: 6,
      color: "#2d5a27",
      agents: ["grokbot", "gemini", "apple-intelligence"],
      isOutdoor: true,
    },
  ],

  connections: [
    { from: "cursor-room", to: "main-space", doorX: 8, doorY: 13 },
    { from: "claude-room", to: "main-space", doorX: 22, doorY: 13 },
  ],

  spawnPoints: {
    jarvis: { room: "cursor-room", x: 6, y: 7 },
    friday: { room: "cursor-room", x: 7, y: 8 },
    cursor: { room: "cursor-room", x: 6, y: 6 },
    "cursor-grunt": { room: "cursor-room", x: 6, y: 6 },
    bumblebee: { room: "cursor-room", x: 8, y: 9 },

    claude: { room: "claude-room", x: 23, y: 7 },
    "claude-code": { room: "claude-room", x: 21, y: 9 },
    "claude-cowork": { room: "claude-room", x: 25, y: 9 },

    grokbot: { room: "main-space", x: 8, y: 17 },
    gemini: { room: "main-space", x: 12, y: 17 },
    "apple-intelligence": { room: "main-space", x: 22, y: 17 },
  },

  furniture: {},
};

export const gameMap = new GameMap(DEFAULT_MAP);
