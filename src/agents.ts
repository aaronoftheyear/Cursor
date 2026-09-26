import { Agent } from './types';
import { AGENT_SPRITES } from './sprites';

export const AGENT_CONFIGS: Omit<
  Agent,
  | 'x'
  | 'y'
  | 'targetX'
  | 'targetY'
  | 'frame'
  | 'frameTimer'
  | 'idleFrame'
  | 'idleTimer'
  | 'currentTask'
  | 'locomotion'
  | 'visibleOnMap'
>[] = [
  // === CURSOR PROJECT COORDINATORS ===
  {
    id: 'jarvis',
    name: 'J.A.R.V.I.S.',
    description: 'Just A Rather Very Intelligent System. Coordinator for Cursor local agents. Manages on-device coding tasks and local development workflows.',
    color: '#ffd700',
    secondaryColor: '#b8860b',
    status: 'idle',
    direction: 'right',
    specialties: ['local', 'coordinator', 'cursor', 'development', 'on-device', 'planning', 'delegation'],
    sprite: AGENT_SPRITES.stand,
    role: 'coordinator',
    subAgents: ['cursor', 'cursor-grunt'],
  },
  {
    id: 'friday',
    name: 'F.R.I.D.A.Y.',
    description: 'Female Replacement Intelligent Digital Assistant Youth. Cursor HQ cloud coordinator. Manages Bumblebee and cloud troubleshooting, CI/CD, and infrastructure.',
    color: '#00bfff',
    secondaryColor: '#1e90ff',
    status: 'idle',
    direction: 'left',
    specialties: ['cloud', 'coordinator', 'troubleshooting', 'ci-cd', 'infrastructure', 'debugging', 'monitoring'],
    sprite: AGENT_SPRITES.stand,
    role: 'coordinator',
    subAgents: ['bumblebee'],
  },
  {
    id: 'bumblebee',
    name: 'Bumblebee',
    description: 'F.R.I.D.A.Y.\'s loyal subagent. Handles cloud task execution, log analysis, and automated fixes. Small but mighty.',
    color: '#ffd700',
    secondaryColor: '#222222',
    status: 'idle',
    direction: 'down',
    specialties: ['cloud-worker', 'logs', 'automated-fixes', 'execution', 'ci', 'testing'],
    sprite: AGENT_SPRITES.stand,
    role: 'subagent',
    parentAgent: 'friday',
  },
  
  // === STANDALONE AGENTS ===
  {
    id: 'cursor',
    name: 'Cursor Grunt',
    description: 'Cursor HQ grunt. Handles coding tasks, refactoring, and IDE work. Reports to J.A.R.V.I.S.',
    color: '#00d4ff',
    secondaryColor: '#0066ff',
    status: 'idle',
    direction: 'right',
    specialties: ['coding', 'refactoring', 'ide', 'code-completion', 'debugging', 'file-editing'],
    sprite: AGENT_SPRITES.stand,
    role: 'subagent',
    parentAgent: 'jarvis',
  },
  {
    id: 'cursor-grunt',
    name: 'Cursor Grunt 2',
    description: 'Second Cursor HQ grunt. Handles file edits, refactors, and local coding tasks. Reports to J.A.R.V.I.S.',
    color: '#7dd3fc',
    secondaryColor: '#0369a1',
    status: 'idle',
    direction: 'left',
    specialties: ['coding', 'refactoring', 'ide', 'file-editing', 'local'],
    sprite: AGENT_SPRITES.stand,
    role: 'subagent',
    parentAgent: 'jarvis',
  },
  {
    id: 'grokbot',
    name: 'Grok',
    description: 'X/Twitter AI with real-time knowledge. Best for current events, social trends, and witty responses.',
    color: '#1da1f2',
    secondaryColor: '#14171a',
    status: 'idle',
    direction: 'left',
    specialties: ['real-time', 'social-media', 'current-events', 'humor', 'twitter', 'trends'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'metabee',
    name: 'Metabee',
    description: 'Aaron\'s desktop assistant. A versatile helper for research, automation, and general tasks.',
    color: '#f59e0b',
    secondaryColor: '#d97706',
    status: 'idle',
    direction: 'down',
    specialties: ['research', 'automation', 'desktop', 'assistant', 'general'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'claude',
    name: 'Claude',
    description: 'Anthropic\'s helpful AI assistant. Excellent for analysis, writing, and thoughtful conversations.',
    color: '#d97706',
    secondaryColor: '#92400e',
    status: 'idle',
    direction: 'right',
    specialties: ['analysis', 'writing', 'research', 'conversation', 'reasoning', 'ethics'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'claude-cowork',
    name: 'Claude Cowork',
    description: 'Collaborative Claude for team workflows. Specialized in multi-agent coordination and handoffs.',
    color: '#8b5cf6',
    secondaryColor: '#6d28d9',
    status: 'idle',
    direction: 'down',
    specialties: ['collaboration', 'coordination', 'workflow', 'handoff', 'team', 'delegation'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Claude specialized for software development. Expert at architecture, debugging, and code review.',
    color: '#10b981',
    secondaryColor: '#059669',
    status: 'idle',
    direction: 'up',
    specialties: ['software', 'architecture', 'code-review', 'debugging', 'terminal', 'git'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    description: 'Google\'s multimodal AI. Strong at image understanding, search integration, and data analysis.',
    color: '#4285f4',
    secondaryColor: '#ea4335',
    status: 'idle',
    direction: 'right',
    specialties: ['multimodal', 'images', 'search', 'data-analysis', 'google', 'vision'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'apple-intelligence',
    name: 'Apple Intelligence',
    description: 'Apple\'s on-device AI. Best for privacy-focused tasks, Siri integration, and Apple ecosystem.',
    color: '#a3a3a3',
    secondaryColor: '#525252',
    status: 'idle',
    direction: 'left',
    specialties: ['privacy', 'on-device', 'siri', 'apple', 'ios', 'macos', 'local'],
    sprite: AGENT_SPRITES.stand,
    role: 'agent',
  },
  {
    id: 'laya',
    name: 'Laya',
    description: 'Main-space router and operator. Owns the workbench; other agents visit her terminal to coordinate.',
    color: '#f472b6',
    secondaryColor: '#be185d',
    status: 'idle',
    direction: 'down',
    specialties: ['routing', 'orchestration', 'main-space', 'coordination', 'dispatch'],
    sprite: AGENT_SPRITES.stand,
    role: 'coordinator',
  },
  {
    id: 'cursor-cloud',
    name: 'Cursor Cloud',
    description: 'Catch-all avatar for Cursor cloud agents that don\'t match specific avatars like F.R.I.D.A.Y. or Bumblebee.',
    color: '#6366f1',
    secondaryColor: '#4f46e5',
    status: 'idle',
    direction: 'down',
    specialties: ['cloud', 'background', 'autonomous', 'remote'],
    sprite: AGENT_SPRITES.stand,
    role: 'subagent',
    parentAgent: 'friday',
  },
];

export function createAgents(canvasWidth: number, canvasHeight: number): Agent[] {
  const margin = 100;
  const agents: Agent[] = [];
  
  AGENT_CONFIGS.forEach((config) => {
    const x = margin + Math.random() * (canvasWidth - margin * 2);
    const y = margin + Math.random() * (canvasHeight - margin * 2);
    
    const deployOnDemand = config.id === 'cursor' || config.id === 'cursor-grunt' || config.id === 'bumblebee';
    agents.push({
      ...config,
      x,
      y,
      targetX: x,
      targetY: y,
      frame: 0,
      frameTimer: 0,
      idleFrame: 0,
      idleTimer: 0,
      currentTask: null,
      visibleOnMap: !deployOnDemand,
      locomotion: 'stand',
    });
  });
  
  return agents;
}

export function getCoordinator(agents: Agent[], agentId: string): Agent | undefined {
  const agent = agents.find(a => a.id === agentId);
  if (!agent?.parentAgent) return undefined;
  return agents.find(a => a.id === agent.parentAgent);
}

export function getSubAgents(agents: Agent[], coordinatorId: string): Agent[] {
  return agents.filter(a => a.parentAgent === coordinatorId);
}
