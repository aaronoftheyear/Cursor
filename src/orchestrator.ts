import { Task } from './types';
import { v4 as uuidv4 } from 'uuid';

// JEV-style task routing rules
interface RoutingRule {
  keywords: string[];
  agentId: string;
  weight: number;
}

const ROUTING_RULES: RoutingRule[] = [
  // Cursor - IDE and code editing
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

export class Orchestrator {
  private tasks: Task[] = [];
  
  analyzeTask(description: string): { agentId: string; confidence: number; reasoning: string }[] {
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
        confidence: Math.min(data.score / 30, 1), // Normalize to 0-1
        reasoning: data.matches.length > 0 
          ? `Matched: ${data.matches.join(', ')}`
          : 'No specific matches, general capability',
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
}

export const orchestrator = new Orchestrator();
