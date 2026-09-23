import { Agent } from './types';
import { AGENT_SPRITES } from './sprites';

export const AGENT_CONFIGS: Omit<Agent, 'x' | 'y' | 'targetX' | 'targetY' | 'frame' | 'frameTimer' | 'currentTask'>[] = [
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI-powered code editor agent. Great for coding tasks, refactoring, and IDE integrations.',
    color: '#00d4ff',
    secondaryColor: '#0066ff',
    status: 'idle',
    direction: 'right',
    specialties: ['coding', 'refactoring', 'ide', 'code-completion', 'debugging', 'file-editing'],
    sprite: AGENT_SPRITES.stand,
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
  },
];

export function createAgents(canvasWidth: number, canvasHeight: number): Agent[] {
  const margin = 100;
  const agents: Agent[] = [];
  
  AGENT_CONFIGS.forEach((config) => {
    const x = margin + Math.random() * (canvasWidth - margin * 2);
    const y = margin + Math.random() * (canvasHeight - margin * 2);
    
    agents.push({
      ...config,
      x,
      y,
      targetX: x,
      targetY: y,
      frame: 0,
      frameTimer: 0,
      currentTask: null,
    });
  });
  
  return agents;
}
