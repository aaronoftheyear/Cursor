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
  
  getAgentSpawnPoint(agentId: string): { x: number; y: number } | undefined {
    const spawn = this.data.spawnPoints[agentId];
    if (!spawn) return undefined;
    
    return {
      x: spawn.x * this.scale,
      y: spawn.y * this.scale,
    };
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
      x: 0,
      y: 0,
      width: 10,
      height: 14,
      color: "#0066ff",
      agents: ["jarvis", "cursor", "bumblebee"],
    },
    {
      id: "claude-room",
      name: "Claude HQ", 
      x: 20,
      y: 0,
      width: 10,
      height: 14,
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
      agents: ["friday", "grokbot", "gemini", "apple-intelligence"],
      isOutdoor: true,
    },
  ],
  
  connections: [
    { from: "cursor-room", to: "main-space", doorX: 5, doorY: 14 },
    { from: "claude-room", to: "main-space", doorX: 25, doorY: 14 },
  ],
  
  spawnPoints: {
    "jarvis": { room: "cursor-room", x: 5, y: 6 },
    "cursor": { room: "cursor-room", x: 3, y: 8 },
    "bumblebee": { room: "cursor-room", x: 7, y: 8 },
    
    "claude": { room: "claude-room", x: 25, y: 6 },
    "claude-code": { room: "claude-room", x: 23, y: 8 },
    "claude-cowork": { room: "claude-room", x: 27, y: 8 },
    
    "friday": { room: "main-space", x: 15, y: 17 },
    "grokbot": { room: "main-space", x: 8, y: 17 },
    "gemini": { room: "main-space", x: 12, y: 17 },
    "apple-intelligence": { room: "main-space", x: 22, y: 17 },
  },
  
  furniture: {
    "cursor-room": [
      { type: "desk", x: 2, y: 2 },
      { type: "computer", x: 2, y: 1 },
      { type: "desk", x: 6, y: 2 },
      { type: "computer", x: 6, y: 1 },
      { type: "server", x: 8, y: 4 },
    ],
    "claude-room": [
      { type: "desk", x: 22, y: 2 },
      { type: "computer", x: 22, y: 1 },
      { type: "desk", x: 26, y: 2 },
      { type: "computer", x: 26, y: 1 },
      { type: "bookshelf", x: 28, y: 4 },
    ],
    "main-space": [
      { type: "tree", x: 3, y: 16 },
      { type: "tree", x: 27, y: 16 },
      { type: "fountain", x: 15, y: 16 },
    ],
  },
};

export const gameMap = new GameMap(DEFAULT_MAP);
