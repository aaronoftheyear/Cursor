import { Agent, GameState, Task } from './types';
import { Renderer } from './renderer';
import { createAgents } from './agents';
import { orchestrator } from './orchestrator';
import { SPRITE_SIZE } from './sprites';

const SCALE = 3;
const MOVE_SPEED = 1.5;
const WANDER_INTERVAL = 3000; // How often agents pick a new destination
const FRAME_DURATION = 150; // Animation frame duration in ms

export class GameEngine {
  private renderer: Renderer;
  private state: GameState;
  private lastTime: number = 0;
  private wanderTimers: Map<string, number> = new Map();
  private mouseX: number = 0;
  private mouseY: number = 0;
  private onAgentSelect: ((agent: Agent | null) => void) | null = null;
  private onTaskComplete: ((task: Task) => void) | null = null;
  
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    
    this.state = {
      agents: createAgents(this.renderer.width, this.renderer.height),
      tasks: [],
      selectedAgent: null,
      hoveredAgent: null,
    };
    
    // Initialize wander timers
    this.state.agents.forEach(agent => {
      this.wanderTimers.set(agent.id, Date.now() + Math.random() * WANDER_INTERVAL);
    });
    
    this.setupEventListeners(canvas);
    this.start();
  }
  
  private setupEventListeners(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      
      const hoveredAgent = this.renderer.getAgentAtPosition(this.state.agents, this.mouseX, this.mouseY);
      this.state.hoveredAgent = hoveredAgent?.id || null;
      canvas.style.cursor = hoveredAgent ? 'pointer' : 'default';
    });
    
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const clickedAgent = this.renderer.getAgentAtPosition(this.state.agents, x, y);
      this.state.selectedAgent = clickedAgent?.id || null;
      
      if (this.onAgentSelect) {
        this.onAgentSelect(clickedAgent);
      }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
      // Keep agents within bounds after resize
      this.state.agents.forEach(agent => {
        const maxX = this.renderer.width - SPRITE_SIZE * SCALE - 20;
        const maxY = this.renderer.height - SPRITE_SIZE * SCALE - 40;
        agent.x = Math.max(20, Math.min(agent.x, maxX));
        agent.y = Math.max(20, Math.min(agent.y, maxY));
        agent.targetX = Math.max(20, Math.min(agent.targetX, maxX));
        agent.targetY = Math.max(20, Math.min(agent.targetY, maxY));
      });
    });
  }
  
  setOnAgentSelect(callback: (agent: Agent | null) => void): void {
    this.onAgentSelect = callback;
  }
  
  setOnTaskComplete(callback: (task: Task) => void): void {
    this.onTaskComplete = callback;
  }
  
  private start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame((time) => this.gameLoop(time));
  }
  
  private gameLoop(currentTime: number): void {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    this.update(deltaTime);
    this.render();
    
    requestAnimationFrame((time) => this.gameLoop(time));
  }
  
  private update(deltaTime: number): void {
    const now = Date.now();
    
    for (const agent of this.state.agents) {
      // Update animation frame
      agent.frameTimer += deltaTime;
      if (agent.frameTimer >= FRAME_DURATION) {
        agent.frameTimer = 0;
        agent.frame = (agent.frame + 1) % 4;
      }
      
      // Check if it's time to wander
      const wanderTime = this.wanderTimers.get(agent.id) || 0;
      if (now >= wanderTime && agent.status !== 'working') {
        this.pickNewDestination(agent);
        this.wanderTimers.set(agent.id, now + WANDER_INTERVAL + Math.random() * 2000);
      }
      
      // Move towards target
      this.moveAgent(agent);
      
      // Simulate task completion
      if (agent.currentTask && agent.status === 'working') {
        const taskDuration = 5000 + Math.random() * 5000; // 5-10 seconds
        const taskAge = now - agent.currentTask.createdAt.getTime();
        
        if (taskAge > taskDuration) {
          this.completeAgentTask(agent);
        }
      }
    }
  }
  
  private pickNewDestination(agent: Agent): void {
    const margin = 60;
    const maxX = this.renderer.width - SPRITE_SIZE * SCALE - margin;
    const maxY = this.renderer.height - SPRITE_SIZE * SCALE - margin;
    
    agent.targetX = margin + Math.random() * (maxX - margin);
    agent.targetY = margin + Math.random() * (maxY - margin);
  }
  
  private moveAgent(agent: Agent): void {
    const dx = agent.targetX - agent.x;
    const dy = agent.targetY - agent.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < 2) {
      return; // Close enough
    }
    
    // Normalize and apply speed
    const speed = agent.status === 'working' ? MOVE_SPEED * 1.5 : MOVE_SPEED;
    const moveX = (dx / distance) * speed;
    const moveY = (dy / distance) * speed;
    
    agent.x += moveX;
    agent.y += moveY;
    
    // Update direction
    if (Math.abs(dx) > Math.abs(dy)) {
      agent.direction = dx > 0 ? 'right' : 'left';
    } else {
      agent.direction = dy > 0 ? 'down' : 'up';
    }
  }
  
  private render(): void {
    this.renderer.clear();
    
    // Sort agents by Y position for proper layering
    const sortedAgents = [...this.state.agents].sort((a, b) => a.y - b.y);
    
    // Draw all agents
    for (const agent of sortedAgents) {
      this.renderer.drawAgent(
        agent,
        agent.id === this.state.selectedAgent,
        agent.id === this.state.hoveredAgent
      );
    }
    
    // Draw tooltip for hovered agent
    if (this.state.hoveredAgent) {
      const agent = this.state.agents.find(a => a.id === this.state.hoveredAgent);
      if (agent) {
        this.renderer.drawTooltip(agent, this.mouseX, this.mouseY);
      }
    }
  }
  
  getAgents(): Agent[] {
    return this.state.agents;
  }
  
  getAgent(id: string): Agent | undefined {
    return this.state.agents.find(a => a.id === id);
  }
  
  assignTaskToAgent(task: Task, agentId: string): void {
    const agent = this.state.agents.find(a => a.id === agentId);
    if (!agent) return;
    
    agent.status = 'working';
    agent.currentTask = task;
    orchestrator.assignTask(task, agentId);
    
    // Make agent move to center when working
    agent.targetX = this.renderer.width / 2 - (SPRITE_SIZE * SCALE) / 2;
    agent.targetY = this.renderer.height / 2 - (SPRITE_SIZE * SCALE) / 2;
  }
  
  private completeAgentTask(agent: Agent): void {
    if (agent.currentTask) {
      orchestrator.completeTask(agent.currentTask.id);
      
      if (this.onTaskComplete) {
        this.onTaskComplete(agent.currentTask);
      }
      
      agent.currentTask = null;
    }
    agent.status = 'idle';
    
    // Pick a new random destination
    this.pickNewDestination(agent);
  }
  
  selectAgent(agentId: string | null): void {
    this.state.selectedAgent = agentId;
  }
}
