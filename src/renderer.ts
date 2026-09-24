import { Agent } from './types';
import { AGENT_SPRITES, SPRITE_SIZE, AGENT_ICONS } from './sprites';

const SCALE = 3; // Scale up the pixel art
const TILE_SIZE = 32;

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
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
  
  clear(): void {
    // Draw background
    this.ctx.fillStyle = '#0f0f23';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw grid floor pattern
    this.ctx.strokeStyle = '#1a1a3e';
    this.ctx.lineWidth = 1;
    
    for (let x = 0; x < this.canvas.width; x += TILE_SIZE) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }
    
    for (let y = 0; y < this.canvas.height; y += TILE_SIZE) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
    
    // Draw some decorative elements (desks, computers, plants)
    this.drawOfficeDecor();
  }
  
  private drawOfficeDecor(): void {
    const decorations = [
      { x: 100, y: 80, type: 'desk' },
      { x: 300, y: 120, type: 'plant' },
      { x: 500, y: 80, type: 'desk' },
      { x: 150, y: 300, type: 'plant' },
      { x: 400, y: 280, type: 'server' },
    ];
    
    for (const decor of decorations) {
      if (decor.x < this.canvas.width && decor.y < this.canvas.height) {
        this.drawDecoration(decor.x, decor.y, decor.type);
      }
    }
  }
  
  private drawDecoration(x: number, y: number, type: string): void {
    this.ctx.save();
    
    switch (type) {
      case 'desk':
        // Desk
        this.ctx.fillStyle = '#3d2817';
        this.ctx.fillRect(x, y, 80, 40);
        this.ctx.fillStyle = '#2a1a0f';
        this.ctx.fillRect(x + 5, y + 40, 10, 20);
        this.ctx.fillRect(x + 65, y + 40, 10, 20);
        // Monitor
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(x + 25, y - 30, 30, 25);
        this.ctx.fillStyle = '#0f0f23';
        this.ctx.fillRect(x + 28, y - 27, 24, 19);
        // Screen glow
        this.ctx.fillStyle = '#00ff00';
        this.ctx.globalAlpha = 0.3;
        this.ctx.fillRect(x + 30, y - 25, 20, 15);
        this.ctx.globalAlpha = 1;
        break;
        
      case 'plant':
        // Pot
        this.ctx.fillStyle = '#8b4513';
        this.ctx.fillRect(x, y + 20, 24, 20);
        // Plant
        this.ctx.fillStyle = '#228b22';
        this.ctx.beginPath();
        this.ctx.arc(x + 12, y + 10, 15, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#32cd32';
        this.ctx.beginPath();
        this.ctx.arc(x + 8, y + 5, 8, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.beginPath();
        this.ctx.arc(x + 18, y + 8, 6, 0, Math.PI * 2);
        this.ctx.fill();
        break;
        
      case 'server':
        // Server rack
        this.ctx.fillStyle = '#2a2a3e';
        this.ctx.fillRect(x, y, 40, 60);
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(x + 3, y + 5, 34, 10);
        this.ctx.fillRect(x + 3, y + 20, 34, 10);
        this.ctx.fillRect(x + 3, y + 35, 34, 10);
        // Blinking lights
        const time = Date.now();
        this.ctx.fillStyle = (time % 1000 < 500) ? '#00ff00' : '#004400';
        this.ctx.fillRect(x + 32, y + 7, 3, 3);
        this.ctx.fillStyle = (time % 800 < 400) ? '#ff0000' : '#440000';
        this.ctx.fillRect(x + 32, y + 22, 3, 3);
        this.ctx.fillStyle = (time % 1200 < 600) ? '#00ff00' : '#004400';
        this.ctx.fillRect(x + 32, y + 37, 3, 3);
        break;
    }
    
    this.ctx.restore();
  }
  
  drawAgent(agent: Agent, isSelected: boolean, isHovered: boolean): void {
    const sprite = this.getSpriteForAgent(agent);
    const colors = this.getAgentColors(agent);
    
    // Draw shadow
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.ctx.beginPath();
    this.ctx.ellipse(
      agent.x + (SPRITE_SIZE * SCALE) / 2,
      agent.y + SPRITE_SIZE * SCALE,
      (SPRITE_SIZE * SCALE) / 3,
      (SPRITE_SIZE * SCALE) / 6,
      0, 0, Math.PI * 2
    );
    this.ctx.fill();
    
    // Draw sprite pixel by pixel
    for (let y = 0; y < SPRITE_SIZE; y++) {
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const colorIndex = sprite[y][x];
        if (colorIndex === 0) continue;
        
        const color = colors[colorIndex];
        if (!color) continue;
        
        this.ctx.fillStyle = color;
        
        // Flip horizontally if facing left
        const drawX = agent.direction === 'left' 
          ? agent.x + (SPRITE_SIZE - 1 - x) * SCALE
          : agent.x + x * SCALE;
        
        this.ctx.fillRect(drawX, agent.y + y * SCALE, SCALE, SCALE);
      }
    }
    
    // Draw agent icon above head
    this.drawAgentIcon(agent);
    
    // Draw selection/hover indicator
    if (isSelected || isHovered) {
      this.ctx.strokeStyle = isSelected ? '#00ff00' : '#ffff00';
      this.ctx.lineWidth = 2;
      this.ctx.setLineDash(isSelected ? [] : [4, 4]);
      this.ctx.strokeRect(
        agent.x - 4,
        agent.y - 4,
        SPRITE_SIZE * SCALE + 8,
        SPRITE_SIZE * SCALE + 8
      );
      this.ctx.setLineDash([]);
    }
    
    // Draw status indicator
    this.drawStatusIndicator(agent);
    
    // Draw name tag
    this.drawNameTag(agent);
  }
  
  private getSpriteForAgent(agent: Agent): number[][] {
    if (agent.status === 'working' || 
        Math.abs(agent.x - agent.targetX) > 2 || 
        Math.abs(agent.y - agent.targetY) > 2) {
      // Walking animation
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
  
  private drawAgentIcon(agent: Agent): void {
    const icon = AGENT_ICONS[agent.id];
    if (!icon) return;
    
    const iconScale = 2;
    const iconX = agent.x + (SPRITE_SIZE * SCALE - icon[0].length * iconScale) / 2;
    const iconY = agent.y - icon.length * iconScale - 8;
    
    // Draw icon background
    this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    this.ctx.fillRect(
      iconX - 2,
      iconY - 2,
      icon[0].length * iconScale + 4,
      icon.length * iconScale + 4
    );
    
    // Draw icon
    for (let y = 0; y < icon.length; y++) {
      for (let x = 0; x < icon[y].length; x++) {
        if (icon[y][x] === 1) {
          this.ctx.fillStyle = agent.color;
          this.ctx.fillRect(
            iconX + x * iconScale,
            iconY + y * iconScale,
            iconScale,
            iconScale
          );
        }
      }
    }
  }
  
  private drawStatusIndicator(agent: Agent): void {
    const indicatorX = agent.x + SPRITE_SIZE * SCALE + 4;
    const indicatorY = agent.y + 4;
    
    let color: string;
    switch (agent.status) {
      case 'idle': color = '#00ff00'; break;
      case 'working': color = '#ffff00'; break;
      case 'offline': color = '#ff0000'; break;
    }
    
    // Pulsing effect for working status
    if (agent.status === 'working') {
      const pulse = Math.sin(Date.now() / 200) * 0.3 + 0.7;
      this.ctx.globalAlpha = pulse;
    }
    
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.arc(indicatorX, indicatorY, 4, 0, Math.PI * 2);
    this.ctx.fill();
    
    this.ctx.globalAlpha = 1;
  }
  
  private drawNameTag(agent: Agent): void {
    const tagX = agent.x + (SPRITE_SIZE * SCALE) / 2;
    const tagY = agent.y + SPRITE_SIZE * SCALE + 12;
    
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
      if (agent.parentAgent) {
        const parent = agents.find(a => a.id === agent.parentAgent);
        if (parent) {
          const startX = agent.x + (SPRITE_SIZE * SCALE) / 2;
          const startY = agent.y + (SPRITE_SIZE * SCALE) / 2;
          const endX = parent.x + (SPRITE_SIZE * SCALE) / 2;
          const endY = parent.y + (SPRITE_SIZE * SCALE) / 2;
          
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
    const spriteWidth = SPRITE_SIZE * SCALE;
    const spriteHeight = SPRITE_SIZE * SCALE;
    
    for (const agent of agents) {
      if (x >= agent.x && x <= agent.x + spriteWidth &&
          y >= agent.y && y <= agent.y + spriteHeight) {
        return agent;
      }
    }
    
    return null;
  }
}
