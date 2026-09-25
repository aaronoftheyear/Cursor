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
  /** Idle anim phase 0|1 (maps to triplet poses 1 and 3), not sprite numbers. */
  idleFrame: number;
  idleTimer: number;
  specialties: string[];
  currentTask: Task | null;
  /** Shown in sidebar when synced from Cursor (no local task). */
  statusDetail?: string;
  statusSource?: 'local' | 'cursor';
  sprite: number[][];
  role: AgentRole;
  parentAgent?: string; // For subagents, the coordinator they report to
  subAgents?: string[]; // For coordinators, their subagent IDs
  /** When false, agent is off-map (e.g. dismissed to spawn pad). */
  visibleOnMap?: boolean;
  /** Sprite pose: stand = idle column (pose 1); walk = walk1/walk2 cycle only while pathing. */
  locomotion: 'stand' | 'walk';
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
