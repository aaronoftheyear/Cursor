export type AgentRole = 'agent' | 'coordinator' | 'subagent';

export interface Agent {
  id: string;
  name: string;
  description: string;
  color: string;
  secondaryColor: string;
  status: 'idle' | 'working' | 'offline';
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: 'left' | 'right' | 'up' | 'down';
  frame: number;
  frameTimer: number;
  specialties: string[];
  currentTask: Task | null;
  sprite: number[][];
  role: AgentRole;
  parentAgent?: string; // For subagents, the coordinator they report to
  subAgents?: string[]; // For coordinators, their subagent IDs
}

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'processing' | 'completed';
  assignedAgent: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Position {
  x: number;
  y: number;
}

export interface GameState {
  agents: Agent[];
  tasks: Task[];
  selectedAgent: string | null;
  hoveredAgent: string | null;
}
