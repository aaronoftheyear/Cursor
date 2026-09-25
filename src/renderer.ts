import { Agent } from './types';
import { AGENT_SPRITES, SPRITE_SIZE } from './sprites';
import { emeraldDisplaySize, getAgentSpriteMirror, getSpriteFrame, LoadedSprite } from './assets';
import { gameMap } from './map';

export interface MapLayout {
  tile: number;
  offsetX: number;
  offsetY: number;
  columns: number;
  rows: number;
}

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private sprites: Map<string, LoadedSprite> = new Map();
  private mapBackground: HTMLImageElement | null = null;
  private mapOverlay: HTMLImageElement | null = null;
  private mapWalkover: HTMLImageElement | null = null;
  private mapMid: HTMLImageElement | null = null;
  private mapWallsFront: HTMLImageElement | null = null;
  private walkoverTiles: Array<{ x: number; y: number }> = [];
  private midTiles: Array<{ x: number; y: number }> = [];
  private wallsFrontTiles: Array<{ x: number; y: number }> = [];
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  
  resize(): void {
    const rect = this.canvas.parentElement!.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.ctx.imageSmoothingEnabled = false;
  }
  
  get width(): number {
    return this.canvas.width;
  }
  
  get height(): number {
    return this.canvas.height;
  }
  
  setSprites(sprites: Map<string, LoadedSprite>): void {
    this.sprites = sprites;
  }

  setMapBackground(image: HTMLImageElement | null): void {
    this.mapBackground = image;
  }

  setMapOverlay(image: HTMLImageElement | null): void {
    this.mapOverlay = image;
  }

  setMapWalkover(image: HTMLImageElement | null, tiles: Array<{ x: number; y: number }> = []): void {
    this.mapWalkover = image;
    this.walkoverTiles = tiles;
  }

  setMapMid(image: HTMLImageElement | null, tiles: Array<{ x: number; y: number }> = []): void {
    this.mapMid = image;
    this.midTiles = tiles;
  }

  setMapWallsFront(image: HTMLImageElement | null, tiles: Array<{ x: number; y: number }> = []): void {
    this.mapWallsFront = image;
    this.wallsFrontTiles = tiles;
  }

  getWalkoverTiles(): Array<{ x: number; y: number }> {
    return this.walkoverTiles;
  }

  getMidTiles(): Array<{ x: number; y: number }> {
    return this.midTiles;
  }

  getWallsFrontTiles(): Array<{ x: number; y: number }> {
    return this.wallsFrontTiles;
  }

  private drawMapLayerTile(
    img: HTMLImageElement | null,
    layout: MapLayout,
    tileX: number,
    tileY: number
  ): void {
    if (!img) return;
    const { tile, offsetX, offsetY, columns } = layout;
    const nativeTile = Math.max(1, Math.round(img.width / columns));
    const sx = tileX * nativeTile;
    const sy = tileY * nativeTile;
    const dx = offsetX + tileX * tile;
    const dy = offsetY + tileY * tile;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(img, sx, sy, nativeTile, nativeTile, dx, dy, tile, tile);
  }

  drawWalkoverTile(layout: MapLayout, tileX: number, tileY: number): void {
    this.drawMapLayerTile(this.mapWalkover, layout, tileX, tileY);
  }

  drawMidTile(layout: MapLayout, tileX: number, tileY: number): void {
    this.drawMapLayerTile(this.mapMid, layout, tileX, tileY);
  }

  drawWallsFrontTile(layout: MapLayout, tileX: number, tileY: number): void {
    this.drawMapLayerTile(this.mapWallsFront, layout, tileX, tileY);
  }

  tileFootSortY(layout: MapLayout, tileY: number): number {
    return layout.offsetY + (tileY + 1) * layout.tile - 1;
  }

  walkoverSortY(layout: MapLayout, tileY: number): number {
    return this.tileFootSortY(layout, tileY);
  }

  getLayout(): MapLayout {
    const { width, height } = gameMap.getMapDimensions();
    const columns = width / gameMap.getTileSize();
    const rows = height / gameMap.getTileSize();
    const tile = Math.max(12, Math.floor(Math.min(this.canvas.width / columns, this.canvas.height / rows)));
    return {
      tile,
      offsetX: Math.floor((this.canvas.width - tile * columns) / 2),
      offsetY: Math.floor((this.canvas.height - tile * rows) / 2),
      columns,
      rows,
    };
  }

  spritePixelSize(agentId?: string): { width: number; height: number } {
    const tile = this.getLayout().tile;
    const custom = agentId ? this.sprites.get(agentId) : undefined;
    if (custom) {
      return emeraldDisplaySize(custom.frameWidth, custom.frameHeight, tile);
    }
    return emeraldDisplaySize(16, 32, tile);
  }

  isAgentMoving(agent: Agent): boolean {
    const epsilon = 1.5;
    return (
      Math.abs(agent.x - agent.targetX) > epsilon ||
      Math.abs(agent.y - agent.targetY) > epsilon
    );
  }

  clear(): void {
    const layout = this.getLayout();
    this.ctx.fillStyle = '#070b14';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.mapBackground) {
      this.drawMapBackground(layout);
    } else {
      this.drawRooms(layout);
      this.drawFurniture(layout);
    }
  }

  drawMapOverlay(layout: MapLayout): void {
    const img = this.mapOverlay;
    if (!img) return;
    const { tile, offsetX, offsetY, columns, rows } = layout;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(img, 0, 0, img.width, img.height, offsetX, offsetY, tile * columns, tile * rows);
  }

  private drawMapBackground(layout: MapLayout): void {
    const img = this.mapBackground;
    if (!img) return;
    const { tile, offsetX, offsetY, columns, rows } = layout;
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      img,
      0,
      0,
      img.width,
      img.height,
      offsetX,
      offsetY,
      tile * columns,
      tile * rows
    );
  }

  private drawRooms(layout: MapLayout): void {
    const { tile, offsetX, offsetY } = layout;
    for (const room of gameMap.getAllRooms()) {
      const x = offsetX + room.x * tile;
      const y = offsetY + room.y * tile;
      const w = room.width * tile;
      const h = room.height * tile;

      this.ctx.fillStyle = room.isOutdoor ? '#1d4a32' : room.id === 'cursor-room' ? '#1a2a4a' : '#3a2a22';
      this.ctx.fillRect(x, y, w, h);

      this.ctx.fillStyle = room.isOutdoor ? '#163c28' : '#12182a';
      for (let col = 0; col < room.width; col++) {
        for (let row = 0; row < room.height; row++) {
          const edge = col === 0 || row === 0 || col === room.width - 1 || row === room.height - 1;
          const door = this.isDoor(room.x + col, room.y + row);
          if (edge && !door && !room.isOutdoor) {
            this.ctx.fillRect(x + col * tile, y + row * tile, tile, tile);
          } else if ((col + row) % 2 === 0) {
            this.ctx.globalAlpha = 0.18;
            this.ctx.fillRect(x + col * tile, y + row * tile, tile, tile);
            this.ctx.globalAlpha = 1;
          }
        }
      }

      if (room.isOutdoor) {
        this.ctx.strokeStyle = '#2f6b45';
      } else {
        this.ctx.strokeStyle = room.color;
      }
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      this.ctx.fillStyle = '#f4f4f4';
      this.ctx.font = '8px "Press Start 2P"';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(room.name, x + tile, y + tile - 4);
    }
  }

  private isDoor(tileX: number, tileY: number): boolean {
    return (
      (tileX === 8 && tileY === 13) ||
      (tileX === 22 && tileY === 13)
    );
  }

  private drawFurniture(layout: MapLayout): void {
    const { tile, offsetX, offsetY } = layout;
    for (const room of gameMap.getAllRooms()) {
      for (const item of gameMap.getFurniture(room.id)) {
        const x = offsetX + item.x * tile;
        const y = offsetY + item.y * tile;
        this.drawFurnitureItem(x, y, tile, item.type);
      }
    }
  }

  private drawFurnitureItem(x: number, y: number, tile: number, type: string): void {
    const s = tile;
    switch (type) {
      case 'desk':
      case 'bench':
        this.ctx.fillStyle = type === 'bench' ? '#6b4a2a' : '#5c3a1e';
        this.ctx.fillRect(x, y + s * 0.35, s, s * 0.45);
        break;
      case 'computer':
        this.ctx.fillStyle = '#101820';
        this.ctx.fillRect(x + s * 0.2, y + s * 0.15, s * 0.6, s * 0.5);
        this.ctx.fillStyle = '#39ff88';
        this.ctx.fillRect(x + s * 0.28, y + s * 0.22, s * 0.44, s * 0.32);
        break;
      case 'server':
        this.ctx.fillStyle = '#243044';
        this.ctx.fillRect(x + s * 0.15, y, s * 0.7, s);
        this.ctx.fillStyle = '#3dff7a';
        this.ctx.fillRect(x + s * 0.65, y + s * 0.15, s * 0.1, s * 0.1);
        break;
      case 'bookshelf':
        this.ctx.fillStyle = '#6a3b22';
        this.ctx.fillRect(x + s * 0.1, y, s * 0.8, s);
        break;
      case 'plant':
      case 'tree':
        this.ctx.fillStyle = type === 'tree' ? '#2f7d32' : '#3cb043';
        this.ctx.fillRect(x + s * 0.2, y, s * 0.6, s * 0.7);
        this.ctx.fillStyle = '#6b3e26';
        this.ctx.fillRect(x + s * 0.4, y + s * 0.7, s * 0.2, s * 0.3);
        break;
      case 'fountain':
        this.ctx.fillStyle = '#7ec8e3';
        this.ctx.fillRect(x + s * 0.1, y + s * 0.2, s * 0.8, s * 0.6);
        this.ctx.fillStyle = '#d7f6ff';
        this.ctx.fillRect(x + s * 0.4, y, s * 0.2, s * 0.35);
        break;
      default:
        break;
    }
  }
  
  drawAgentShadow(agent: Agent): void {
    const size = this.agentDrawSize(agent);
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.beginPath();
    this.ctx.ellipse(
      agent.x + size.width / 2,
      agent.y + size.height,
      size.width / 3,
      size.width / 6,
      0,
      0,
      Math.PI * 2
    );
    this.ctx.fill();
  }

  drawAgent(agent: Agent, isSelected: boolean, _isHovered: boolean): void {
    const size = this.agentDrawSize(agent);

    const custom = this.sprites.get(agent.id);
    if (custom) {
      this.drawCustomSprite(agent, custom, size);
    } else {
      this.drawProgrammaticSprite(agent, size);
    }

    if (isSelected) {
      this.ctx.strokeStyle = '#00ff00';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(
        agent.x - 4,
        agent.y - 4,
        size.width + 8,
        size.height + 8
      );
      this.drawNameTag(agent);
    }
  }
  
  private agentDrawSize(agent: Agent): { width: number; height: number } {
    return this.spritePixelSize(agent.id);
  }

  private drawCustomSprite(
    agent: Agent,
    sprite: LoadedSprite,
    size: { width: number; height: number }
  ): void {
    const walking = agent.locomotion === 'walk';
    const frame = walking
      ? getSpriteFrame(sprite, agent.direction, agent.frame, getAgentSpriteMirror(agent.id), 'walk')
      : getSpriteFrame(sprite, agent.direction, 0, getAgentSpriteMirror(agent.id), 'idle');
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.save();
    if (frame.flip) {
      this.ctx.translate(agent.x + size.width, agent.y);
      this.ctx.scale(-1, 1);
      this.ctx.drawImage(sprite.image, frame.x, frame.y, frame.width, frame.height, 0, 0, size.width, size.height);
    } else {
      this.ctx.drawImage(sprite.image, frame.x, frame.y, frame.width, frame.height, agent.x, agent.y, size.width, size.height);
    }
    this.ctx.restore();
  }

  private drawProgrammaticSprite(agent: Agent, size: { width: number; height: number }): void {
    const sprite = this.getSpriteForAgent(agent);
    const colors = this.getAgentColors(agent);
    const px = size.width / SPRITE_SIZE;
    const py = size.height / SPRITE_SIZE;
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const colorIndex = sprite[y][x];
        if (colorIndex === 0) continue;
        const color = colors[colorIndex];
        if (!color) continue;
        this.ctx.fillStyle = color;
        const drawX = agent.direction === 'left'
          ? agent.x + (SPRITE_SIZE - 1 - x) * px
          : agent.x + x * px;
        this.ctx.fillRect(drawX, agent.y + y * py, px, py);
      }
    }
  }

  private getSpriteForAgent(agent: Agent): number[][] {
    if (agent.locomotion === 'walk') {
      return agent.frame % 2 === 0 ? AGENT_SPRITES.walk1 : AGENT_SPRITES.walk2;
    }
    return AGENT_SPRITES.stand;
  }
  
  private getAgentColors(agent: Agent): Record<number, string> {
    return {
      1: agent.color,           // Primary (hair/hat)
      2: agent.secondaryColor,  // Secondary (body)
      3: '#ffdbac',             // Skin tone
      4: '#000000',             // Black/outline
    };
  }
  
  private drawNameTag(agent: Agent): void {
    const size = this.agentDrawSize(agent);
    const tagX = agent.x + size.width / 2;
    const tagY = agent.y + size.height + 12;
    
    this.ctx.font = '8px "Press Start 2P"';
    this.ctx.textAlign = 'center';
    
    // Role badge for coordinators
    if (agent.role === 'coordinator') {
      const badgeY = tagY - 12;
      this.ctx.fillStyle = '#ffd700';
      this.ctx.fillRect(tagX - 12, badgeY - 6, 24, 10);
      this.ctx.fillStyle = '#000';
      this.ctx.font = '5px "Press Start 2P"';
      this.ctx.fillText('COORD', tagX, badgeY);
      this.ctx.font = '8px "Press Start 2P"';
    } else if (agent.role === 'subagent') {
      const badgeY = tagY - 12;
      this.ctx.fillStyle = '#888';
      this.ctx.fillRect(tagX - 10, badgeY - 6, 20, 10);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '5px "Press Start 2P"';
      this.ctx.fillText('SUB', tagX, badgeY);
      this.ctx.font = '8px "Press Start 2P"';
    }
    
    // Background
    const textWidth = this.ctx.measureText(agent.name).width;
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx.fillRect(tagX - textWidth / 2 - 4, tagY - 8, textWidth + 8, 12);
    
    // Text
    this.ctx.fillStyle = agent.color;
    this.ctx.fillText(agent.name, tagX, tagY);
  }
  
  drawAgentConnections(agents: Agent[]): void {
    this.ctx.save();
    this.ctx.setLineDash([4, 4]);
    this.ctx.lineWidth = 1;
    
    for (const agent of agents) {
      if (agent.visibleOnMap === false) continue;
      if (agent.parentAgent) {
        const parent = agents.find(a => a.id === agent.parentAgent);
        if (parent && parent.visibleOnMap !== false) {
          const startSize = this.agentDrawSize(agent);
          const endSize = this.agentDrawSize(parent);
          const startX = agent.x + startSize.width / 2;
          const startY = agent.y + startSize.height / 2;
          const endX = parent.x + endSize.width / 2;
          const endY = parent.y + endSize.height / 2;
          
          // Draw connection line
          this.ctx.strokeStyle = parent.color;
          this.ctx.globalAlpha = 0.4;
          this.ctx.beginPath();
          this.ctx.moveTo(startX, startY);
          this.ctx.lineTo(endX, endY);
          this.ctx.stroke();
        }
      }
    }
    
    this.ctx.restore();
  }
  
  drawTooltip(agent: Agent, mouseX: number, mouseY: number, allAgents: Agent[]): void {
    const padding = 10;
    const lineHeight = 14;
    const maxWidth = 220;
    
    this.ctx.font = '8px "Press Start 2P"';
    
    const lines = this.wrapText(agent.description, maxWidth - padding * 2);
    
    // Calculate extra height for role info
    let extraLines = 0;
    if (agent.role === 'coordinator' && agent.subAgents?.length) {
      extraLines = 1;
    } else if (agent.role === 'subagent' && agent.parentAgent) {
      extraLines = 1;
    }
    
    const tooltipHeight = lines.length * lineHeight + padding * 2 + 34 + (extraLines * lineHeight);
    const tooltipWidth = maxWidth;
    
    let tooltipX = mouseX + 15;
    let tooltipY = mouseY + 15;
    
    // Keep tooltip on screen
    if (tooltipX + tooltipWidth > this.canvas.width) {
      tooltipX = mouseX - tooltipWidth - 15;
    }
    if (tooltipY + tooltipHeight > this.canvas.height) {
      tooltipY = mouseY - tooltipHeight - 15;
    }
    
    // Background
    this.ctx.fillStyle = '#16213e';
    this.ctx.fillRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    this.ctx.strokeStyle = agent.color;
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(tooltipX, tooltipY, tooltipWidth, tooltipHeight);
    
    // Title with role
    this.ctx.fillStyle = agent.color;
    const roleLabel = agent.role === 'coordinator' ? ' [COORD]' : agent.role === 'subagent' ? ' [SUB]' : '';
    this.ctx.fillText(agent.name + roleLabel, tooltipX + padding, tooltipY + padding + 8);
    
    // Status
    const statusColors = { idle: '#00ff00', working: '#ffff00', offline: '#ff0000' };
    this.ctx.fillStyle = statusColors[agent.status];
    this.ctx.fillText(`[${agent.status.toUpperCase()}]`, tooltipX + padding, tooltipY + padding + 20);
    
    // Role info
    let currentY = tooltipY + padding + 34;
    if (agent.role === 'coordinator' && agent.subAgents?.length) {
      const subNames = agent.subAgents
        .map(id => allAgents.find(a => a.id === id)?.name || id)
        .join(', ');
      this.ctx.fillStyle = '#ffd700';
      this.ctx.fillText(`Manages: ${subNames}`, tooltipX + padding, currentY);
      currentY += lineHeight;
    } else if (agent.role === 'subagent' && agent.parentAgent) {
      const parent = allAgents.find(a => a.id === agent.parentAgent);
      if (parent) {
        this.ctx.fillStyle = '#888';
        this.ctx.fillText(`Reports to: ${parent.name}`, tooltipX + padding, currentY);
        currentY += lineHeight;
      }
    }
    
    // Description
    this.ctx.fillStyle = '#aaaaaa';
    lines.forEach((line, i) => {
      this.ctx.fillText(line, tooltipX + padding, currentY + i * lineHeight);
    });
  }
  
  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = this.ctx.measureText(testLine);
      
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  }
  
  getAgentAtPosition(agents: Agent[], x: number, y: number): Agent | null {
    for (const agent of agents) {
      if (agent.visibleOnMap === false) continue;
      const { width: spriteWidth, height: spriteHeight } = this.spritePixelSize(agent.id);
      if (x >= agent.x && x <= agent.x + spriteWidth &&
          y >= agent.y && y <= agent.y + spriteHeight) {
        return agent;
      }
    }
    
    return null;
  }
}
