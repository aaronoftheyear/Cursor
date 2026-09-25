import type { MapActionTile } from './mapActions';
import type { LiveActivityDepth, LiveCursorActivity } from './liveStatus';
import type { Agent } from './types';
import type { Task } from './types';

export type ActionKind =
  | 'music'
  | 'working'
  | 'computer'
  | 'research'
  | 'planning'
  | 'trash'
  | 'running'
  | 'programming'
  | 'research_tv'
  | 'spawn_cursor_grunt'
  | 'spawn_claude_grunt'
  | 'lookup_cursor'
  | 'lookup_claude'
  | 'laya_workbench'
  | 'laya_chat'
  | 'idle_relax'
  | 'main_workstation'
  | 'mac_studio'
  | 'macbook_pro'
  | 'github';

export type AgentGroup = 'bumblebee' | 'cursor' | 'claude' | 'main';

export interface ActionSpotRule {
  x: number;
  y: number;
  kind: ActionKind;
  /** Foot-tile Y (same grid as Tiled Actions layer). */
  group: AgentGroup;
  facing: 'left' | 'right' | 'up' | 'down';
  allowedAgentIds?: string[];
  excludeGroups?: AgentGroup[];
}

interface ActionSpotOverride extends ActionSpotRule {}

export const CURSOR_AGENT_IDS = ['jarvis', 'friday', 'cursor', 'cursor-grunt', 'bumblebee'] as const;
export const CLAUDE_AGENT_IDS = ['claude', 'claude-code', 'claude-cowork'] as const;
export const MAIN_AGENT_IDS = ['grokbot', 'gemini', 'apple-intelligence', 'laya'] as const;

/** Match `public/assets/maps/hq.json` room bounds (tile coords). */
const MAIN_SPACE_MIN_Y = 15;
const CLAUDE_ROOM_MIN_X = 17;

/** Fallback if baked Actions JSON has not loaded yet. */
/** Cursor terminal scientist — only the `cursor` grunt uses this tile. */
export const CURSOR_TERMINAL_GRUNT_TILE = { x: 11, y: 6, facing: 'up' as const };

/** Off-map stash / dismiss target for Cursor grunts (matches Tiled spawn pad). */
export const CURSOR_GRUNT_SPAWN_TILE = { x: 6, y: 6, facing: 'down' as const };

export const ACTION_SPOT_RULES: ActionSpotRule[] = [
  { x: 4, y: 5, kind: 'music', group: 'bumblebee', facing: 'left' },
  { x: 4, y: 6, kind: 'working', group: 'bumblebee', facing: 'left' },
  { x: 9, y: 6, kind: 'computer', group: 'cursor', facing: 'right' },
  { x: 9, y: 8, kind: 'computer', group: 'cursor', facing: 'right' },
  { x: 6, y: 7, kind: 'research', group: 'cursor', facing: 'up' },
  { x: 7, y: 7, kind: 'research', group: 'cursor', facing: 'up' },
  { x: 6, y: 4, kind: 'planning', group: 'cursor', facing: 'up' },
  { x: 7, y: 4, kind: 'planning', group: 'cursor', facing: 'up' },
  { x: 9, y: 10, kind: 'trash', group: 'cursor', facing: 'right' },
  { x: 9, y: 10, kind: 'running', group: 'cursor', facing: 'right' },
  { x: 21, y: 6, kind: 'computer', group: 'claude', facing: 'left' },
  { x: 21, y: 8, kind: 'computer', group: 'claude', facing: 'left' },
  { x: 21, y: 10, kind: 'computer', group: 'claude', facing: 'left' },
  { x: 25, y: 5, kind: 'research', group: 'claude', facing: 'up' },
  { x: 26, y: 5, kind: 'research', group: 'claude', facing: 'up' },
  { x: 26, y: 10, kind: 'research_tv', group: 'claude', facing: 'up' },
  { x: 23, y: 11, kind: 'programming', group: 'claude', facing: 'up' },
  { x: 24, y: 11, kind: 'programming', group: 'claude', facing: 'up' },
  {
    x: CURSOR_GRUNT_SPAWN_TILE.x,
    y: CURSOR_GRUNT_SPAWN_TILE.y,
    kind: 'spawn_cursor_grunt',
    group: 'cursor',
    facing: CURSOR_GRUNT_SPAWN_TILE.facing,
  },
  { x: 22, y: 5, kind: 'spawn_claude_grunt', group: 'claude', facing: 'up' },
];

let mapActionSpotRules: ActionSpotRule[] | null = null;

function spotKey(x: number, y: number): string {
  return `${x},${y}`;
}

function applyOverrides(base: ActionSpotRule[], overrides: ActionSpotOverride[]): ActionSpotRule[] {
  const merged = new Map(base.map((rule) => [spotKey(rule.x, rule.y), rule]));
  for (const override of overrides) {
    merged.set(spotKey(override.x, override.y), { ...override });
  }
  return [...merged.values()];
}

/** Built from baked Actions JSON + `action-spots.overrides.json`. */
export async function loadActionSpotsFromMap(tiles: MapActionTile[]): Promise<void> {
  const base = tiles
    .map((tile) => tileToActionSpotRule(tile))
    .filter((rule): rule is ActionSpotRule => rule !== null);

  let rules = base;
  try {
    const res = await fetch('/assets/maps/action-spots.overrides.json?v=1');
    if (res.ok) {
      const data = (await res.json()) as { spots?: ActionSpotOverride[] };
      if (data.spots?.length) {
        rules = applyOverrides(base, data.spots);
      }
    }
  } catch {
    /* use base rules only */
  }

  mapActionSpotRules = rules;
  const byGroup = rules.reduce<Record<string, number>>((acc, rule) => {
    acc[rule.group] = (acc[rule.group] ?? 0) + 1;
    return acc;
  }, {});
  console.debug('Action spots loaded:', byGroup, `(${rules.length} rules)`);
}

/** @deprecated use loadActionSpotsFromMap */
export function setActionSpotsFromMap(tiles: MapActionTile[]): void {
  void loadActionSpotsFromMap(tiles);
}

function activeActionSpotRules(): ActionSpotRule[] {
  return mapActionSpotRules ?? ACTION_SPOT_RULES;
}

const GID_TO_SPOT: Record<
  number,
  { kind: ActionKind; facing: ActionSpotRule['facing']; groups?: AgentGroup[] }
> = {
  4240: { kind: 'planning', facing: 'up' },
  4200: { kind: 'music', facing: 'left', groups: ['bumblebee'] },
  4216: { kind: 'working', facing: 'left', groups: ['bumblebee'] },
  4208: { kind: 'computer', facing: 'right' },
  4234: { kind: 'computer', facing: 'right' },
  4233: { kind: 'computer', facing: 'left' },
  4053: { kind: 'research', facing: 'up' },
  3438: { kind: 'trash', facing: 'right' },
  3447: { kind: 'research_tv', facing: 'up' },
  3439: { kind: 'programming', facing: 'up' },
  6581: { kind: 'programming', facing: 'up' },
};

function tileGroup(tile: MapActionTile): AgentGroup {
  if (tile.gid === 4200 || tile.gid === 4216) return 'bumblebee';
  if (tile.gid === 6590) {
    if (tile.y >= MAIN_SPACE_MIN_Y) return 'main';
    return tile.x < CLAUDE_ROOM_MIN_X ? 'cursor' : 'claude';
  }
  if (tile.y >= MAIN_SPACE_MIN_Y) return 'main';
  if (tile.x >= CLAUDE_ROOM_MIN_X) return 'claude';
  return 'cursor';
}

function tileToActionSpotRule(tile: MapActionTile): ActionSpotRule | null {
  if (tile.gid === 6590) {
    if (tile.y >= MAIN_SPACE_MIN_Y) {
      return {
        x: tile.x,
        y: tile.y,
        kind: 'computer',
        group: 'main',
        facing: 'up',
      };
    }
    const group = tileGroup(tile);
    return {
      x: tile.x,
      y: tile.y,
      kind: group === 'cursor' ? 'spawn_cursor_grunt' : 'spawn_claude_grunt',
      group,
      facing: 'up',
    };
  }

  const spec = GID_TO_SPOT[tile.gid];
  if (!spec) {
    console.warn(`Actions layer: unmapped gid ${tile.gid} at (${tile.x},${tile.y})`);
    return null;
  }

  const group = spec.groups?.length ? spec.groups[0] : tileGroup(tile);

  return {
    x: tile.x,
    y: tile.y,
    kind: spec.kind,
    group,
    facing: inferFacing(spec.facing, tile),
  };
}

function inferFacing(
  defaultFacing: ActionSpotRule['facing'],
  tile: MapActionTile
): ActionSpotRule['facing'] {
  if (tile.gid === 4233) {
    return tile.x >= CLAUDE_ROOM_MIN_X ? 'left' : 'right';
  }
  if (tile.gid === 4234) {
    return tile.x >= CLAUDE_ROOM_MIN_X ? 'left' : 'right';
  }
  if (tile.gid === 4208) return 'right';
  return defaultFacing;
}

function cursorComputerFacing(rule: ActionSpotRule, agentId: string): ActionSpotRule {
  if (rule.kind !== 'computer' || agentGroup(agentId) !== 'cursor') {
    return rule;
  }
  return { ...rule, facing: 'right' };
}

export function agentGroup(agentId: string): AgentGroup | null {
  if (agentId === 'laya') return 'main';
  if ((CURSOR_AGENT_IDS as readonly string[]).includes(agentId)) return 'cursor';
  if ((CLAUDE_AGENT_IDS as readonly string[]).includes(agentId)) return 'claude';
  if ((MAIN_AGENT_IDS as readonly string[]).includes(agentId)) return 'main';
  return null;
}

export function isCursorTeam(agentId: string): boolean {
  return (CURSOR_AGENT_IDS as readonly string[]).includes(agentId);
}

export function isClaudeTeam(agentId: string): boolean {
  return (CLAUDE_AGENT_IDS as readonly string[]).includes(agentId);
}

function spotAllowed(rule: ActionSpotRule, agentId: string): boolean {
  if (rule.allowedAgentIds?.length && !rule.allowedAgentIds.includes(agentId)) {
    return false;
  }
  const group = agentGroup(agentId);
  if (rule.excludeGroups && group && rule.excludeGroups.includes(group)) {
    return false;
  }
  return true;
}

export function actionKindFromLiveActivity(
  activity: LiveCursorActivity,
  agent: Agent,
  depth: LiveActivityDepth = 'brief'
): ActionKind {
  if (agentGroup(agent.id) === 'cursor' && agent.id === 'bumblebee') {
    if (depth === 'deep' && activity === 'reading') return 'music';
    return 'working';
  }

  if (agentGroup(agent.id) === 'cursor') {
    if (depth === 'brief') {
      return 'computer';
    }
    const deepMap: Record<LiveCursorActivity, ActionKind> = {
      planning: 'planning',
      reading: 'research',
      editing: 'computer',
      running: 'computer',
      thinking: 'planning',
    };
    return deepMap[activity];
  }

  if (agentGroup(agent.id) === 'claude') {
    if (depth === 'brief') {
      return 'computer';
    }
    const deepMap: Record<LiveCursorActivity, ActionKind> = {
      planning: 'programming',
      reading: 'research',
      editing: 'computer',
      running: 'programming',
      thinking: 'research',
    };
    return deepMap[activity];
  }

  return classifyWorkAction(agent, null);
}

export function classifyWorkAction(agent: Agent, task?: Task | null): ActionKind {
  const text = (task?.description ?? '').toLowerCase();
  const group = agentGroup(agent.id);

  if (group === 'cursor') {
    if (agent.id === 'bumblebee') {
      if (/music|audio|sound|dj|listen/.test(text)) return 'music';
      return 'working';
    }
    if (/trash|clean up|cleanup|garbage|delete/.test(text)) return 'trash';
    if (/plan|calculat|estimate|roadmap|architect|design/.test(text)) return 'planning';
    if (/research|read|doc|documentation|investigate/.test(text)) return 'research';
    return 'computer';
  }

  if (group === 'claude') {
    if (/github|git|repo|pull request|commit/.test(text)) return 'github';
    if (/program|automat|script|workflow|hook|pipeline/.test(text)) return 'programming';
    if (/tv|video|watch|screen|monitoring/.test(text)) return 'research_tv';
    if (/research|read|analysis|write|paper/.test(text)) return 'research';
    return 'computer';
  }

  if (group === 'main') {
    if (agent.id === 'laya') {
      if (/route|assign|dispatch|orchestrat/.test(text)) return 'laya_workbench';
      return 'laya_chat';
    }
    if (/mac studio|studio files|macstudio/.test(text)) return 'mac_studio';
    if (/macbook|mac book|laptop files|mbp/.test(text)) return 'macbook_pro';
    if (/cursor files|cursor project|from cursor/.test(text)) return 'lookup_cursor';
    if (/claude files|claude project|from claude|anthropic/.test(text)) return 'lookup_claude';
    if (/relax|coffee|break|chill|idle/.test(text)) return 'idle_relax';
    if (/laya|router|routing/.test(text)) return 'laya_chat';
    if (/research|read|doc|investigate|cloud|ci|deploy/.test(text)) return 'research';
    return 'main_workstation';
  }

  return 'computer';
}

function isTerminalTile(x: number, y: number): boolean {
  return x === CURSOR_TERMINAL_GRUNT_TILE.x && y === CURSOR_TERMINAL_GRUNT_TILE.y;
}

function isSpotFree(rule: ActionSpotRule, occupiedFootTiles: ReadonlySet<string>): boolean {
  return !occupiedFootTiles.has(spotKey(rule.x, rule.y));
}

export function pickActionSpot(
  agent: Agent,
  kind: ActionKind,
  occupiedFootTiles: ReadonlySet<string> = new Set()
): ActionSpotRule | null {
  const group = agentGroup(agent.id);
  if (!group) return null;

  const rules = activeActionSpotRules();
  const pool = rules.filter(
    (s) =>
      s.kind === kind &&
      !s.kind.startsWith('spawn_') &&
      !(isTerminalTile(s.x, s.y) && agent.id !== 'cursor') &&
      spotAllowed(s, agent.id) &&
      isSpotFree(s, occupiedFootTiles) &&
      (s.group === group ||
        (agent.id === 'bumblebee' && s.group === 'bumblebee') ||
        s.kind === 'laya_chat' ||
        s.kind === 'laya_workbench')
  );
  if (pool.length === 0) {
    const fallback = rules.filter(
      (s) =>
        !s.kind.startsWith('spawn_') &&
        !(isTerminalTile(s.x, s.y) && agent.id !== 'cursor') &&
        spotAllowed(s, agent.id) &&
        isSpotFree(s, occupiedFootTiles) &&
        (s.group === group ||
          (agent.id === 'bumblebee' && s.group === 'bumblebee') ||
          (group === 'main' && s.group === 'main'))
    );
    if (fallback.length === 0) return null;
    return cursorComputerFacing(pickStable(agent.id, fallback), agent.id);
  }
  return cursorComputerFacing(pickStable(agent.id + kind, pool), agent.id);
}

/** When idle, main agents may sit on couch markers. */
export function pickIdleRelaxSpot(agent: Agent): ActionSpotRule | null {
  return pickActionSpot(agent, 'idle_relax');
}

function pickStable(seed: string, pool: ActionSpotRule[]): ActionSpotRule {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash + seed.charCodeAt(i)) | 0;
  }
  return pool[Math.abs(hash) % pool.length];
}

export function getGruntSpawnSpot(which: 'cursor' | 'claude'): ActionSpotRule | null {
  if (which === 'cursor') {
    return {
      x: CURSOR_GRUNT_SPAWN_TILE.x,
      y: CURSOR_GRUNT_SPAWN_TILE.y,
      kind: 'spawn_cursor_grunt',
      group: 'cursor',
      facing: CURSOR_GRUNT_SPAWN_TILE.facing,
    };
  }
  const kind = 'spawn_claude_grunt';
  const pool = activeActionSpotRules().filter((s) => s.kind === kind);
  if (pool.length === 0) return null;
  return pickStable(`spawn-${which}`, pool);
}
