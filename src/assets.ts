// Asset loader for Pokemon GBA-style sprites and tiles

export interface AssetManifest {
  version: string;
  style: string;
  tileSize: number;
  spriteSize: number;
  agents: Record<string, AgentAssets>;
  tileset: TilesetAssets;
  ui: UIAssets;
  map: MapConfig;
}

export interface AgentAssets {
  name: string;
  sprite: string;
  idle: string;
  portrait: string;
  /** emerald = left column mirrored for right; right = art faces right (mirror for left). */
  spriteFacing?: 'emerald' | 'right';
}

export interface TilesetAssets {
  floor: string;
  walls: string;
  furniture: string;
  decorations: string;
}

export interface UIAssets {
  textbox: string;
  menu: string;
  icons: string;
  taskPanel: string;
}

export interface MapConfig {
  width: number;
  height: number;
  tileSize?: number;
  file: string;
  background?: string;
  overlay?: string;
  collision?: string;
  /** Bumped when collision JSON is re-baked (cache bust). */
  collisionRev?: string;
  walkover?: string;
  mid?: string;
  wallsFront?: string;
  actions?: string;
}

export type SpriteSheetLayout = 'directionGrid4x4' | 'directionStrip144x32' | 'generic';

export interface LoadedSprite {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  framesPerRow: number;
  totalFrames: number;
  layout: SpriteSheetLayout;
}

function inferSpriteSheetLayout(
  width: number,
  height: number,
  fallbackSpriteSize: number
): { frameWidth: number; frameHeight: number; layout: SpriteSheetLayout } {
  const cellSizes: Array<[number, number]> = [
    [16, 32],
    [32, 32],
    [36, 32],
    [48, 48],
  ];
  for (const [frameWidth, frameHeight] of cellSizes) {
    if (width % frameWidth !== 0 || height % frameHeight !== 0) continue;
    const cols = width / frameWidth;
    const rows = height / frameHeight;
    if (cols === 4 && rows === 4) {
      return { frameWidth, frameHeight, layout: 'directionGrid4x4' };
    }
  }

  /** Single-row strip: 3 frames per facing (idle, walk1, walk2); right mirrors left. */
  if (width === 144 && height === 32) {
    return { frameWidth: 16, frameHeight: 32, layout: 'directionStrip144x32' };
  }

  const size = fallbackSpriteSize;
  return { frameWidth: size, frameHeight: size, layout: 'generic' };
}

class AssetLoader {
  private manifest: AssetManifest | null = null;
  private loadedImages: Map<string, HTMLImageElement> = new Map();
  private loadedSprites: Map<string, LoadedSprite> = new Map();
  private useCustomAssets: boolean = false;
  private basePath: string = '/assets/';
  
  async loadManifest(): Promise<AssetManifest | null> {
    try {
      const response = await fetch(`${this.basePath}manifest.json`);
      if (!response.ok) {
        console.log('No custom asset manifest found, using default sprites');
        return null;
      }
      this.manifest = await response.json();
      return this.manifest;
    } catch (error) {
      console.log('Using default programmatic sprites');
      return null;
    }
  }
  
  async loadImage(path: string): Promise<HTMLImageElement | null> {
    if (this.loadedImages.has(path)) {
      return this.loadedImages.get(path)!;
    }
    
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.loadedImages.set(path, img);
        resolve(img);
      };
      img.onerror = () => {
        console.log(`Asset not found: ${path}`);
        resolve(null);
      };
      img.src = `${this.basePath}${path}?v=grid4x4`;
    });
  }
  
  async loadAgentSprite(agentId: string): Promise<LoadedSprite | null> {
    if (!this.manifest) return null;
    
    const agentAssets = this.manifest.agents[agentId];
    if (!agentAssets) return null;
    
    const cacheKey = `sprite:${agentId}`;
    if (this.loadedSprites.has(cacheKey)) {
      return this.loadedSprites.get(cacheKey)!;
    }
    
    const image = await this.loadImage(agentAssets.sprite);
    if (!image) return null;
    
    const inferred = inferSpriteSheetLayout(
      image.width,
      image.height,
      this.manifest.spriteSize
    );
    const { frameWidth, frameHeight, layout } = inferred;
    const framesPerRow = image.width / frameWidth;
    const rows = image.height / frameHeight;
    const sprite: LoadedSprite = {
      image,
      frameWidth,
      frameHeight,
      framesPerRow,
      totalFrames: framesPerRow * rows,
      layout,
    };
    
    this.loadedSprites.set(cacheKey, sprite);
    this.useCustomAssets = true;
    return sprite;
  }
  
  async loadAllAgentSprites(agentIds: string[]): Promise<Map<string, LoadedSprite>> {
    const sprites = new Map<string, LoadedSprite>();
    
    await Promise.all(
      agentIds.map(async (id) => {
        const sprite = await this.loadAgentSprite(id);
        if (sprite) {
          sprites.set(id, sprite);
        }
      })
    );
    
    return sprites;
  }
  
  async loadTileset(type: keyof TilesetAssets): Promise<HTMLImageElement | null> {
    if (!this.manifest) return null;
    return this.loadImage(this.manifest.tileset[type]);
  }

  async loadMapWalkover(): Promise<HTMLImageElement | null> {
    const path = this.manifest?.map?.walkover;
    if (!path) return null;
    return this.loadImage(path);
  }

  async loadMapMid(): Promise<HTMLImageElement | null> {
    const path = this.manifest?.map?.mid;
    if (!path) return null;
    return this.loadImage(path);
  }

  async loadMapWallsFront(): Promise<HTMLImageElement | null> {
    const path = this.manifest?.map?.wallsFront;
    if (!path) return null;
    return this.loadImage(path);
  }

  getMapActionsPath(): string | null {
    return this.manifest?.map?.actions ?? null;
  }

  async loadMapActions(): Promise<import('./mapActions').MapActionsData | null> {
    const path = this.getMapActionsPath();
    if (!path) return null;
    const rev = this.manifest?.map?.collisionRev ?? '1';
    try {
      const res = await fetch(`${this.basePath}${path}?v=${rev}`);
      if (!res.ok) return null;
      return (await res.json()) as import('./mapActions').MapActionsData;
    } catch {
      return null;
    }
  }

  async loadMapOverlay(): Promise<HTMLImageElement | null> {
    const path = this.manifest?.map?.overlay;
    if (!path) return null;
    return this.loadImage(path);
  }

  getMapCollisionPath(): string | null {
    return this.manifest?.map?.collision ?? null;
  }

  async loadMapCollision(): Promise<import('./mapGrid').MapGrid | null> {
    const path = this.getMapCollisionPath();
    if (!path) return null;
    const rev = this.manifest?.map?.collisionRev ?? '1';
    const { MapGrid } = await import('./mapGrid');
    return MapGrid.load(`${this.basePath}${path}?v=${rev}`);
  }

  async loadMapBackground(): Promise<HTMLImageElement | null> {
    const path = this.manifest?.map?.background;
    if (!path) return null;
    return this.loadImage(path);
  }
  
  async loadUI(type: keyof UIAssets): Promise<HTMLImageElement | null> {
    if (!this.manifest) return null;
    return this.loadImage(this.manifest.ui[type]);
  }
  
  hasCustomAssets(): boolean {
    return this.useCustomAssets;
  }
  
  getManifest(): AssetManifest | null {
    return this.manifest;
  }
  
  getSpriteSize(): number {
    return this.manifest?.spriteSize ?? 32;
  }
  
  getTileSize(): number {
    return this.manifest?.tileSize ?? 32;
  }
}

export const assetLoader = new AssetLoader();

/**
 * 144×32 strip [D-w1][D-idle][D-w2][U…][L…] — standard frame order.
 * Each direction triplet: walk1, idle, walk2 (idle in position 1).
 */
const STRIP_COL_WALK1 = 0;
const STRIP_COL_IDLE = 1;
const STRIP_COL_WALK2 = 2;
const STRIP_WALK_COLS = [
  STRIP_COL_WALK1,
  STRIP_COL_WALK2,
  STRIP_COL_WALK1,
  STRIP_COL_WALK2,
];
const STRIP_DIRECTION_ORIGIN: Record<string, number> = {
  down: 0,
  up: 3,
  left: 6,
  right: 6,
};

/**
 * 4×4 grid per sheet:
 * row 0 forward (down), 1 left, 2 right, 3 back (up)
 * col 0 idle, 1 walk1, 2 (unused), 3 walk2
 */
const GRID_DIRECTION_ROW: Record<string, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};
const GRID_COL_IDLE = 0;
const GRID_COL_WALK1 = 1;
const GRID_COL_WALK2 = 3;
const GRID_WALK_COLS = [GRID_COL_WALK1, GRID_COL_WALK2, GRID_COL_WALK1, GRID_COL_WALK2];

export type SpriteAnimMode = 'walk' | 'idle';

export function emeraldDisplaySize(
  frameWidth: number,
  frameHeight: number,
  mapTilePx: number
): { width: number; height: number } {
  const scale = (mapTilePx * 2) / frameHeight;
  return {
    width: Math.round(frameWidth * scale),
    height: Math.round(frameHeight * scale),
  };
}

export function getSpriteFrame(
  sprite: LoadedSprite,
  direction: 'up' | 'down' | 'left' | 'right',
  frameIndex: number,
  mirrorRightFromLeft = true,
  mode: SpriteAnimMode = 'walk'
): { x: number; y: number; width: number; height: number; flip: boolean } {
  if (sprite.layout === 'directionGrid4x4') {
    const row = GRID_DIRECTION_ROW[direction] ?? 0;
    const col =
      mode === 'idle'
        ? GRID_COL_IDLE
        : GRID_WALK_COLS[frameIndex % GRID_WALK_COLS.length];
    return {
      x: col * sprite.frameWidth,
      y: row * sprite.frameHeight,
      width: sprite.frameWidth,
      height: sprite.frameHeight,
      flip: false,
    };
  }

  const origin = STRIP_DIRECTION_ORIGIN[direction] ?? 0;
  const offset =
    mode === 'idle'
      ? STRIP_COL_IDLE
      : STRIP_WALK_COLS[frameIndex % STRIP_WALK_COLS.length];
  return {
    x: (origin + offset) * sprite.frameWidth,
    y: 0,
    width: sprite.frameWidth,
    height: sprite.frameHeight,
    flip:
      (direction === 'left' || direction === 'right') &&
      (mirrorRightFromLeft ? direction === 'right' : direction === 'left'),
  };
}

const DEFAULT_MIRROR_RIGHT_FROM_LEFT = true;

/** Claude strips are drawn facing right — flip logic is inverted vs standard Emerald NPCs. */
const AGENT_MIRROR_OVERRIDES: Record<string, boolean> = {
  claude: false,
  'claude-code': false,
  'claude-cowork': false,
};

export function getAgentSpriteMirror(agentId: string): boolean {
  if (agentId in AGENT_MIRROR_OVERRIDES) {
    return AGENT_MIRROR_OVERRIDES[agentId];
  }
  const facing = assetLoader.getManifest()?.agents[agentId]?.spriteFacing;
  if (facing === 'right') return false;
  if (facing === 'emerald') return true;
  return DEFAULT_MIRROR_RIGHT_FROM_LEFT;
}
