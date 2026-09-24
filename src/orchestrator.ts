import { Task } from './types';
import { v4 as uuidv4 } from 'uuid';
import { layaClient } from './laya';

// Fallback keyword-based routing rules (used when Laya is unavailable)
interface RoutingRule {
  keywords: string[];
  agentId: string;
  weight: number;
}

const ROUTING_RULES: RoutingRule[] = [
  // === CURSOR PROJECT COORDINATORS ===
  
  // J.A.R.V.I.S. - Local Cursor coordinator
  { keywords: ['jarvis', 'local', 'on-device', 'laptop', 'desktop'], agentId: 'jarvis', weight: 15 },
  { keywords: ['coordinate', 'plan', 'project', 'feature', 'migration'], agentId: 'jarvis', weight: 12 },
  { keywords: ['cursor local', 'local agent', 'local development'], agentId: 'jarvis', weight: 18 },
  
  // F.R.I.D.A.Y. - Cloud troubleshooting coordinator
  { keywords: ['friday', 'cloud', 'troubleshoot', 'infrastructure'], agentId: 'friday', weight: 15 },
  { keywords: ['ci', 'cd', 'pipeline', 'deploy', 'production'], agentId: 'friday', weight: 12 },
  { keywords: ['monitor', 'alert', 'incident', 'outage', 'downtime'], agentId: 'friday', weight: 14 },
  { keywords: ['cloud agent', 'cloud troubleshooting'], agentId: 'friday', weight: 18 },
  
  // Bumblebee - F.R.I.D.A.Y.'s subagent
  { keywords: ['bumblebee', 'worker', 'execute', 'run'], agentId: 'bumblebee', weight: 12 },
  { keywords: ['logs', 'log analysis', 'stack trace', 'error log'], agentId: 'bumblebee', weight: 14 },
  { keywords: ['automated fix', 'auto-fix', 'quick fix'], agentId: 'bumblebee', weight: 12 },
  
  // === STANDALONE AGENTS ===
  
  // Cursor - IDE and code editing (reports to J.A.R.V.I.S.)
  { keywords: ['edit', 'refactor', 'ide', 'autocomplete', 'snippet', 'format'], agentId: 'cursor', weight: 10 },
  { keywords: ['vscode', 'editor', 'cursor'], agentId: 'cursor', weight: 15 },
  
  // Grok - Real-time and social
  { keywords: ['twitter', 'x.com', 'tweet', 'social', 'trending', 'meme'], agentId: 'grokbot', weight: 10 },
  { keywords: ['news', 'current', 'today', 'happening', 'real-time'], agentId: 'grokbot', weight: 8 },
  { keywords: ['funny', 'joke', 'witty', 'humor'], agentId: 'grokbot', weight: 7 },
  
  // Claude - General analysis and writing
  { keywords: ['analyze', 'analysis', 'explain', 'understand', 'research'], agentId: 'claude', weight: 10 },
  { keywords: ['write', 'essay', 'article', 'blog', 'content', 'draft'], agentId: 'claude', weight: 10 },
  { keywords: ['ethics', 'philosophy', 'reasoning', 'debate'], agentId: 'claude', weight: 12 },
  
  // Claude Cowork - Collaboration
  { keywords: ['team', 'collaborate', 'coordinate', 'workflow', 'delegate'], agentId: 'claude-cowork', weight: 12 },
  { keywords: ['handoff', 'multi-agent', 'together', 'parallel'], agentId: 'claude-cowork', weight: 10 },
  
  // Claude Code - Software development
  { keywords: ['code', 'programming', 'software', 'develop', 'build', 'create'], agentId: 'claude-code', weight: 8 },
  { keywords: ['debug', 'bug', 'fix', 'error', 'issue'], agentId: 'claude-code', weight: 10 },
  { keywords: ['architecture', 'design', 'system', 'api', 'backend', 'frontend'], agentId: 'claude-code', weight: 10 },
  { keywords: ['git', 'commit', 'merge', 'branch', 'pull request', 'pr'], agentId: 'claude-code', weight: 12 },
  { keywords: ['terminal', 'command', 'shell', 'bash', 'cli'], agentId: 'claude-code', weight: 10 },
  
  // Gemini - Multimodal and Google
  { keywords: ['image', 'picture', 'photo', 'visual', 'see', 'look'], agentId: 'gemini', weight: 12 },
  { keywords: ['google', 'search', 'find', 'lookup'], agentId: 'gemini', weight: 8 },
  { keywords: ['data', 'chart', 'graph', 'statistics', 'numbers'], agentId: 'gemini', weight: 9 },
  { keywords: ['video', 'youtube', 'multimedia'], agentId: 'gemini', weight: 10 },
  
  // Apple Intelligence - Privacy and Apple ecosystem
  { keywords: ['privacy', 'private', 'secure', 'local', 'on-device'], agentId: 'apple-intelligence', weight: 12 },
  { keywords: ['apple', 'mac', 'iphone', 'ipad', 'ios', 'macos'], agentId: 'apple-intelligence', weight: 15 },
  { keywords: ['siri', 'shortcut', 'automation'], agentId: 'apple-intelligence', weight: 12 },
];

// Agent descriptions for Laya
const AGENT_DESCRIPTIONS: Record<string, string> = {
  // Cursor Project Coordinators
  'jarvis': 'J.A.R.V.I.S. - Coordinator for Cursor local agents. Manages on-device coding, local development, and project planning.',
  'friday': 'F.R.I.D.A.Y. - Cloud troubleshooting coordinator. Manages cloud agents for CI/CD, infrastructure, monitoring, and incident response.',
  'bumblebee': 'Bumblebee - Cloud worker subagent. Handles log analysis, automated fixes, test execution, and CI tasks.',
  // Standalone agents
  'cursor': 'AI-powered code editor. Best for coding tasks, refactoring, IDE integrations, and code completion.',
  'grokbot': 'X/Twitter AI with real-time knowledge. Best for current events, social trends, and witty responses.',
  'claude': 'General AI assistant. Excellent for analysis, writing, research, and thoughtful conversations.',
  'claude-cowork': 'Collaborative AI for team workflows. Specialized in multi-agent coordination and handoffs.',
  'claude-code': 'Software development specialist. Expert at architecture, debugging, code review, and git.',
  'gemini': 'Multimodal AI. Strong at image understanding, search integration, and data analysis.',
  'apple-intelligence': 'On-device AI. Best for privacy-focused tasks, Siri integration, and Apple ecosystem.',
};

export interface RoutingResult {
  agentId: string;
  confidence: number;
  reasoning: string;
  usedLaya: boolean;
  latencyMs?: number;
  allProbabilities?: Record<string, number>;
}

export class Orchestrator {
  private tasks: Task[] = [];
  
  async analyzeTaskWithLaya(description: string): Promise<RoutingResult[]> {
    // Try Laya first
    const agents = Object.entries(AGENT_DESCRIPTIONS).map(([id, desc]) => ({
      id,
      description: desc,
    }));
    
    const layaResult = await layaClient.chooseAgent(description, agents);
    
    if (layaResult) {
      // Convert Laya probabilities to rankings
      const rankings = Object.entries(layaResult.probabilities)
        .map(([agentId, prob]) => ({
          agentId,
          confidence: prob,
          reasoning: agentId === layaResult.agentId 
            ? `Laya selected (${Math.round(layaResult.confidence * 100)}% confidence)`
            : `Laya probability: ${Math.round(prob * 100)}%`,
          usedLaya: true,
          latencyMs: layaResult.latencyMs,
          allProbabilities: layaResult.probabilities,
        }))
        .sort((a, b) => b.confidence - a.confidence);
      
      return rankings;
    }
    
    // Fallback to keyword-based routing
    return this.analyzeTaskKeywords(description);
  }
  
  analyzeTaskKeywords(description: string): RoutingResult[] {
    const lowerDesc = description.toLowerCase();
    const scores: Map<string, { score: number; matches: string[] }> = new Map();
    
    // Initialize scores for all agents
    const agentIds = [...new Set(ROUTING_RULES.map(r => r.agentId))];
    agentIds.forEach(id => scores.set(id, { score: 0, matches: [] }));
    
    // Calculate scores based on keyword matches
    for (const rule of ROUTING_RULES) {
      for (const keyword of rule.keywords) {
        if (lowerDesc.includes(keyword)) {
          const current = scores.get(rule.agentId)!;
          current.score += rule.weight;
          if (!current.matches.includes(keyword)) {
            current.matches.push(keyword);
          }
        }
      }
    }
    
    // Sort by score and return rankings
    const rankings = Array.from(scores.entries())
      .map(([agentId, data]) => ({
        agentId,
        confidence: Math.min(data.score / 30, 1),
        reasoning: data.matches.length > 0 
          ? `Keyword matches: ${data.matches.join(', ')}`
          : 'No specific matches, general capability',
        usedLaya: false,
      }))
      .sort((a, b) => b.confidence - a.confidence);
    
    // If no clear winner, give slight boost to Claude as general-purpose
    if (rankings[0].confidence === 0) {
      const claudeIndex = rankings.findIndex(r => r.agentId === 'claude');
      if (claudeIndex !== -1) {
        rankings[claudeIndex].confidence = 0.3;
        rankings[claudeIndex].reasoning = 'Default general-purpose assistant';
        rankings.sort((a, b) => b.confidence - a.confidence);
      }
    }
    
    return rankings;
  }
  
  // Synchronous version for backwards compatibility
  analyzeTask(description: string): RoutingResult[] {
    return this.analyzeTaskKeywords(description);
  }
  
  createTask(description: string): Task {
    const task: Task = {
      id: uuidv4(),
      description,
      status: 'pending',
      assignedAgent: null,
      createdAt: new Date(),
      completedAt: null,
    };
    this.tasks.push(task);
    return task;
  }
  
  assignTask(task: Task, agentId: string): void {
    task.assignedAgent = agentId;
    task.status = 'processing';
  }
  
  completeTask(taskId: string): void {
    const task = this.tasks.find(t => t.id === taskId);
    if (task) {
      task.status = 'completed';
      task.completedAt = new Date();
    }
  }
  
  getTasks(): Task[] {
    return this.tasks;
  }
  
  getRecentTasks(limit: number = 10): Task[] {
    return this.tasks.slice(-limit);
  }
  
  isLayaAvailable(): boolean {
    return layaClient.isAvailable();
  }
}

export const orchestrator = new Orchestrator();
