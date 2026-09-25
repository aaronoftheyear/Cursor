import type { GameEngine } from './engine';
import type { LiveStatusSnapshot } from './liveStatus';
import { EMPTY_LIVE_STATUS } from './liveStatus';

const POLL_MS = 1500;

export function startLiveStatusSync(
  engine: GameEngine,
  onApplied?: () => void
): () => void {
  let lastUpdatedAt: string | undefined;

  const poll = async (): Promise<void> => {
    try {
      const res = await fetch(`/live-status.json?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as LiveStatusSnapshot;
      if (!data?.agents) return;
      engine.applyActiveTerminalCount(data.activeTerminals ?? 0);
      if (data.updatedAt && data.updatedAt === lastUpdatedAt) return;
      lastUpdatedAt = data.updatedAt;
      engine.applyLiveStatus(data);
      onApplied?.();
    } catch {
      // Dev server or hooks may be offline — dashboard still runs on simulated tasks.
    }
  };

  void poll();
  const id = window.setInterval(() => void poll(), POLL_MS);
  return () => window.clearInterval(id);
}

export function parseLiveStatusJson(text: string): LiveStatusSnapshot {
  try {
    const parsed = JSON.parse(text) as LiveStatusSnapshot;
    if (parsed && typeof parsed === 'object' && parsed.agents) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_LIVE_STATUS };
}
