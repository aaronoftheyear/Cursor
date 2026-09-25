import { GameEngine } from './engine';
import { orchestrator, RoutingResult } from './orchestrator';
import { startLiveStatusSync } from './statusSync';
import { Agent } from './types';

class AIAgentDashboard {
  readonly engine: GameEngine;
  private selectedAgent: Agent | null = null;
  
  constructor() {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.engine = new GameEngine(canvas);
    
    this.engine.setOnAgentSelect((agent) => {
      this.selectedAgent = agent;
      this.updateAgentList();
    });
    
    this.engine.setOnTaskComplete((task) => {
      this.showNotification(`Task completed by ${task.assignedAgent}!`);
      this.updateTaskQueue();
    });
    
    this.setupUI();
    this.updateClock();
    this.updateAgentList();
    this.updateLayaStatus();
    
    setInterval(() => this.updateClock(), 1000);
    setInterval(() => this.updateAgentList(), 500);
    setInterval(() => this.updateLayaStatus(), 5000);

    startLiveStatusSync(this.engine, () => this.updateAgentList());

    if (import.meta.env.DEV) {
      (window as unknown as { __aiDashboard?: AIAgentDashboard }).__aiDashboard = this;
      this.applyDebugPinsFromQuery();
    }
  }

  /** ?debugPin=jarvis@10,20&debugHide=1 hides all agents except pinned */
  private applyDebugPinsFromQuery(): void {
    const params = new URLSearchParams(window.location.search);
    const pin = params.get('debugPin');
    if (!pin) return;

    const run = () => {
      if (params.get('debugHide') === '1') {
        const ids = pin.split(';').map((p) => p.split('@')[0]?.trim()).filter(Boolean) as string[];
        this.engine.setDebugAgentVisibility(ids);
      }
      for (const part of pin.split(';')) {
        const [agentId, coords] = part.split('@');
        if (!agentId || !coords) continue;
        const [tx, ty] = coords.split(',').map((n) => parseInt(n, 10));
        if (Number.isFinite(tx) && Number.isFinite(ty)) {
          this.engine.pinAgentAtFootTile(agentId.trim(), tx, ty);
        }
      }
    };

    window.setTimeout(run, 4000);
    window.setTimeout(run, 8000);
  }
  
  private setupUI(): void {
    const submitBtn = document.getElementById('submit-task') as HTMLButtonElement;
    const taskInput = document.getElementById('task-input') as HTMLTextAreaElement;
    
    submitBtn.addEventListener('click', () => {
      const description = taskInput.value.trim();
      if (!description) return;
      
      this.submitTask(description);
      taskInput.value = '';
    });
    
    taskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitBtn.click();
      }
    });
  }
  
  private async submitTask(description: string): Promise<void> {
    const task = orchestrator.createTask(description);
    
    // Try Laya first, then fall back to keywords
    const rankings = await orchestrator.analyzeTaskWithLaya(description);
    const bestMatch = rankings[0];
    const agent = this.engine.getAgent(bestMatch.agentId);
    
    if (agent && agent.status !== 'working') {
      this.engine.assignTaskToAgent(task, bestMatch.agentId);
      this.showRoutingNotification(agent, bestMatch);
    } else if (agent) {
      // Find next available agent
      const availableRanking = rankings.find(r => {
        const a = this.engine.getAgent(r.agentId);
        return a && a.status !== 'working';
      });
      
      if (availableRanking) {
        const nextAgent = this.engine.getAgent(availableRanking.agentId)!;
        this.engine.assignTaskToAgent(task, availableRanking.agentId);
        this.showNotification(
          `${agent.name} is busy. Task assigned to ${nextAgent.name}!`
        );
      } else {
        this.showNotification('All agents are busy! Task queued...');
      }
    }
    
    this.updateTaskQueue();
  }
  
  private showRoutingNotification(agent: Agent, result: RoutingResult): void {
    const confidencePercent = Math.round(result.confidence * 100);
    const layaTag = result.usedLaya ? '🧠 LAYA' : '🔑 Keywords';
    const latencyInfo = result.latencyMs ? ` (${result.latencyMs}ms)` : '';
    
    let message = `${layaTag}${latencyInfo}\n`;
    message += `Assigned to ${agent.name} (${confidencePercent}% match)\n`;
    message += result.reasoning;
    
    this.showNotification(message);
  }
  
  private updateClock(): void {
    const timeEl = document.getElementById('time');
    const countEl = document.getElementById('agent-count');
    
    if (timeEl) {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit'
      });
    }
    
    if (countEl) {
      const agents = this.engine.getAgents();
      const online = agents.filter(a => a.status !== 'offline').length;
      countEl.textContent = `${online} agents online`;
    }
  }
  
  private updateLayaStatus(): void {
    const statusBar = document.querySelector('.status-bar');
    if (!statusBar) return;
    
    const layaAvailable = orchestrator.isLayaAvailable();
    
    // Check if Laya indicator already exists
    let layaIndicator = document.getElementById('laya-status');
    if (!layaIndicator) {
      layaIndicator = document.createElement('span');
      layaIndicator.id = 'laya-status';
      layaIndicator.style.marginLeft = '10px';
      statusBar.appendChild(layaIndicator);
    }
    
    if (layaAvailable) {
      layaIndicator.innerHTML = '| <span style="color: #0f0;">🧠 LAYA</span>';
      layaIndicator.title = 'Laya is connected - using AI-powered routing';
    } else {
      layaIndicator.innerHTML = '| <span style="color: #888;">🔑 Keywords</span>';
      layaIndicator.title = 'Laya unavailable - using keyword-based routing';
    }
  }
  
  private updateAgentList(): void {
    const container = document.getElementById('agent-list');
    if (!container) return;
    
    const agents = this.engine.getAgents();
    
    // Group agents: coordinators first, then standalone agents
    const coordinators = agents.filter(a => a.role === 'coordinator');
    const standaloneAgents = agents.filter(a => a.role === 'agent');
    
    container.innerHTML = '';
    
    // Coordinators section
    if (coordinators.length > 0) {
      container.innerHTML += '<h2 style="font-size: 10px; color: #ffd700; margin-bottom: 12px;">👑 COORDINATORS</h2>';
      
      coordinators.forEach(coordinator => {
        container.appendChild(this.createAgentCard(coordinator, agents));
        
        // Show subagents indented under coordinator
        const subagents = agents.filter(
          (a) => a.parentAgent === coordinator.id && a.visibleOnMap !== false
        );
        subagents.forEach(subagent => {
          const subCard = this.createAgentCard(subagent, agents);
          subCard.style.marginLeft = '16px';
          subCard.style.borderLeft = `2px solid ${coordinator.color}`;
          container.appendChild(subCard);
        });
      });
    }
    
    // Standalone agents section
    if (standaloneAgents.length > 0) {
      container.innerHTML += '<h2 style="font-size: 10px; color: #e94560; margin-bottom: 12px; margin-top: 16px;">🤖 AGENTS</h2>';
      standaloneAgents.forEach(agent => {
        container.appendChild(this.createAgentCard(agent, agents));
      });
    }
  }
  
  private createAgentCard(agent: Agent, allAgents: Agent[]): HTMLDivElement {
    const card = document.createElement('div');
    card.className = `agent-card ${agent.status === 'working' ? 'working' : ''} ${this.selectedAgent?.id === agent.id ? 'selected' : ''}`;
    
    // Role badge
    let roleBadge = '';
    if (agent.role === 'coordinator') {
      roleBadge = '<span style="font-size: 5px; background: #ffd700; color: #000; padding: 1px 3px; margin-left: 4px;">COORD</span>';
    } else if (agent.role === 'subagent') {
      const parent = allAgents.find(a => a.id === agent.parentAgent);
      roleBadge = `<span style="font-size: 5px; background: #555; color: #fff; padding: 1px 3px; margin-left: 4px;">→ ${parent?.name || 'SUB'}</span>`;
    }
    
    card.innerHTML = `
      <div class="agent-header">
        <div class="agent-avatar" style="background: ${agent.color}; border-radius: 4px;"></div>
        <div>
          <div class="agent-name">${agent.name}${roleBadge}</div>
          <div class="agent-status ${agent.status}">${agent.status.toUpperCase()}</div>
        </div>
      </div>
      ${agent.currentTask ? `<div style="font-size: 6px; color: #888; margin-top: 4px;">Working on: ${agent.currentTask.description.substring(0, 30)}...</div>` : agent.statusDetail ? `<div style="font-size: 6px; color: #6cf; margin-top: 4px;">${agent.statusDetail}</div>` : ''}
    `;
    
    card.addEventListener('click', () => {
      this.selectedAgent = agent;
      this.engine.selectAgent(agent.id);
      this.updateAgentList();
    });
    
    return card;
  }
  
  private updateTaskQueue(): void {
    const container = document.getElementById('task-queue');
    if (!container) return;
    
    const tasks = orchestrator.getRecentTasks(5);
    
    container.innerHTML = '<h2 style="font-size: 10px; color: #e94560; margin-bottom: 12px;">📋 TASK QUEUE</h2>';
    
    if (tasks.length === 0) {
      container.innerHTML += '<div style="font-size: 8px; color: #666;">No tasks yet...</div>';
      return;
    }
    
    tasks.reverse().forEach(task => {
      const item = document.createElement('div');
      item.className = `task-item ${task.status}`;
      
      const statusIcon = task.status === 'completed' ? '✓' : task.status === 'processing' ? '⟳' : '○';
      const agentName = task.assignedAgent ? 
        this.engine.getAgent(task.assignedAgent)?.name || task.assignedAgent : 
        'Unassigned';
      
      item.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span>${statusIcon} ${task.description.substring(0, 25)}${task.description.length > 25 ? '...' : ''}</span>
        </div>
        <div style="color: #666; margin-top: 2px;">→ ${agentName}</div>
      `;
      
      container.appendChild(item);
    });
  }
  
  private showNotification(message: string): void {
    // Remove any existing notification
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.style.whiteSpace = 'pre-line';
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }
}

// Initialize the dashboard
document.addEventListener('DOMContentLoaded', () => {
  new AIAgentDashboard();
});
