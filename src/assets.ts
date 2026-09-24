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
  file: string;
}

export interface LoadedSprite {
  image: HTMLImageElement;
  frameWidth: number;
  frameHeight: number;
  framesPerRow: number;
  totalFrames: number;
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
      img.src = `${this.basePath}${path}`;
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
    
    const spriteSize = this.manifest.spriteSize;
    const sprite: LoadedSprite = {
      image,
      frameWidth: spriteSize,
      frameHeight: spriteSize,
      framesPerRow: image.width / spriteSize,
      totalFrames: (image.width / spriteSize) * (image.height / spriteSize),
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

// Direction mappings for sprite sheets (Pokemon GBA standard)
export const DIRECTION_ROW: Record<string, number> = {
  'down': 0,
  'left': 1,
  'right': 2,
  'up': 3,
};

// Helper to get sprite frame coordinates
export function getSpriteFrame(
  sprite: LoadedSprite,
  direction: 'up' | 'down' | 'left' | 'right',
  frameIndex: number
): { x: number; y: number; width: number; height: number } {
  const row = DIRECTION_ROW[direction];
  const col = frameIndex % sprite.framesPerRow;
  
  return {
    x: col * sprite.frameWidth,
    y: row * sprite.frameHeight,
    width: sprite.frameWidth,
    height: sprite.frameHeight,
  };
}
