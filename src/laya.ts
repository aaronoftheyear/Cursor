// Laya - Self-hosted Jev alternative for typed decisions
// https://github.com/NandhaKishorM/laya

export interface LayaConfig {
  endpoint: string;
  enabled: boolean;
}

export interface LayaChoiceRequest {
  model: string;
  questions: Array<{
    state: string;
    criteria: Record<string, string | null>;
  }>;
}

export interface LayaChoiceResponse {
  answers: Array<{
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
  }>;
  model: string;
  latency_ms: number;
}

export interface LayaScoreRequest {
  model: string;
  questions: Array<{
    state: string;
    levels: number;
    legend?: Record<string, string>;
  }>;
}

export interface LayaScoreResponse {
  answers: Array<{
    score: number;
    probabilities: Record<string, number>;
    confidence: number;
  }>;
  model: string;
  latency_ms: number;
}

const DEFAULT_CONFIG: LayaConfig = {
  endpoint: 'http://127.0.0.1:8787',
  enabled: true,
};

export class LayaClient {
  private config: LayaConfig;
  private available: boolean = false;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30 seconds when online
  private offlineCheckInterval: number = 120000; // 2 minutes when offline
  
  constructor(config: Partial<LayaConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.checkHealth();
  }
  
  async checkHealth(): Promise<boolean> {
    if (!this.config.enabled) {
      this.available = false;
      return false;
    }
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`${this.config.endpoint}/healthz`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.available = response.ok;
      this.lastHealthCheck = Date.now();
      return this.available;
    } catch {
      this.available = false;
      this.lastHealthCheck = Date.now();
      return false;
    }
  }
  
  isAvailable(): boolean {
    const interval = this.available ? this.healthCheckInterval : this.offlineCheckInterval;
    if (Date.now() - this.lastHealthCheck > interval) {
      this.checkHealth();
    }
    return this.available;
  }
  
  async chooseAgent(
    taskDescription: string,
    agents: Array<{ id: string; description: string }>
  ): Promise<{ agentId: string; confidence: number; probabilities: Record<string, number>; latencyMs: number } | null> {
    if (!this.available) {
      await this.checkHealth();
      if (!this.available) return null;
    }
    
    const criteria: Record<string, string | null> = {};
    for (const agent of agents) {
      criteria[agent.id] = agent.description;
    }
    
    const request: LayaChoiceRequest = {
      model: 'laya-latest',
      questions: [{
        state: `Task: ${taskDescription}\n\nChoose the best AI agent to handle this task based on their specialties.`,
        criteria,
      }],
    };
    
    try {
      const response = await fetch(`${this.config.endpoint}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) {
        console.warn('Laya request failed:', response.status);
        return null;
      }
      
      const data: LayaChoiceResponse = await response.json();
      const answer = data.answers[0];
      
      return {
        agentId: answer.choice,
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        latencyMs: data.latency_ms,
      };
    } catch (error) {
      console.warn('Laya request error:', error);
      this.available = false;
      return null;
    }
  }
  
  async scoreUrgency(taskDescription: string): Promise<{ score: number; confidence: number } | null> {
    if (!this.available) return null;
    
    const request: LayaScoreRequest = {
      model: 'laya-latest',
      questions: [{
        state: `Task: ${taskDescription}\n\nHow urgent is this task?`,
        levels: 5,
        legend: {
          '1': 'Not urgent - can wait',
          '2': 'Low priority',
          '3': 'Normal priority',
          '4': 'High priority',
          '5': 'Critical - needs immediate attention',
        },
      }],
    };
    
    try {
      const response = await fetch(`${this.config.endpoint}/v1/systemone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(5000),
      });
      
      if (!response.ok) return null;
      
      const data: LayaScoreResponse = await response.json();
      const answer = data.answers[0];
      
      return {
        score: answer.score,
        confidence: answer.confidence,
      };
    } catch {
      return null;
    }
  }
}

export const layaClient = new LayaClient();
