import { Agent, GameState, Task } from './types';
import { MapLayout, Renderer } from './renderer';
import { createAgents } from './agents';
import { orchestrator } from './orchestrator';
import { assetLoader } from './assets';
import { MapGrid } from './mapGrid';
import { findTilePath, TileCoord } from './pathfind';
import {
  agentGroup,
  actionKindFromLiveActivity,
  classifyWorkAction,
  CURSOR_TERMINAL_GRUNT_TILE,
  getGruntSpawnSpot,
  loadActionSpotsFromMap,
  pickActionSpot,
} from './actionSpots';
import { gameMap, loadMapData } from './map';
import type {
  LiveActivityDepth,
  LiveCursorActivity,
  LiveStatusSnapshot,
} from './liveStatus';
import {
  NPC_INITIAL_DELAY_MAX_MS,
  NPC_LOOK_AROUND_CHANCE,
  NPC_WALK_TILES_MAX,
  pickShortWalkGoal,
  randomLookDirection,
  randomNpcPauseMs,
  truncatePath,
} from './npcMotion';
import {
  buildSortedRenderQueue,
  AgentRenderInfo,
  TileRenderInfo,
} from './renderQueue';

const MOVE_SPEED = 1.15;
const WORK_MOVE_SPEED = 1.25;
const FRAME_DURATION = 150; // Walk cycle frame duration in ms
const ARRIVE_EPSILON = 2; // px — snap and switch to idle pose 1 at or below this
const HOME_ROAM_IDLE_MS = 45_000; // Cursor/Claude teams roam outside HQ after this long idle

export class GameEngine {
  private renderer: Renderer;
  private state: GameState;
  private lastTime: number = 0;
  private wanderTimers: Map<string, number> = new Map();
  private mouseX: number = 0;
  private mouseY: number = 0;
  private onAgentSelect: ((agent: Agent | null) => void) | null = null;
  private onTaskComplete: ((task: Task) => void) | null = null;
  private mapGrid: MapGrid | null = null;
  private collisionRequired = false;
  private mapReady = false;
  private agentTilePaths = new Map<string, TileCoord[]>();
  private agentStuckFrames = new Map<string, number>();
  private agentWorkFacing = new Map<string, 'left' | 'right' | 'up' | 'down'>();
  private agentMoveAxis = new Map<string, 'x' | 'y'>();
  private liveStatusStamp = new Map<string, string>();
  private liveCursorActivity = new Map<string, LiveCursorActivity>();
  private activeCursorTerminals = 0;
  private agentWasMoving = new Map<string, boolean>();
  private agentIdleSince = new Map<string, number>();
  private agentDismissing = new Set<string>();
  /** Walking from spawn pad to the integrated terminal tile. */
  private agentTerminalMarch = new Set<string>();
  private agentPostedAtTerminal = new Set<string>();
  private agentNavGoal = new Map<string, TileCoord>();
  /** Foot tile reserved while agent is working at an action spot. */
  private agentWorkTile = new Map<string, TileCoord>();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    
    this.state = {
      agents: createAgents(this.renderer.width, this.renderer.height),
      tasks: [],
      selectedAgent: null,
      hoveredAgent: null,
    };
    
    // Initialize wander timers
    this.state.agents.forEach(agent => {
      this.wanderTimers.set(agent.id, Date.now() + Math.random() * NPC_INITIAL_DELAY_MAX_MS);
    });
    
    this.placeAgents();
    this.setupEventListeners(canvas);
    void this.loadSprites().then(() => {
      this.mapReady = true;
      this.placeAgents();
      this.ensureAgentsOnWalkableTiles();
      this.setAgentsIdleAtCurrentPosition();
      this.stashOffMapGruntsAtSpawn();
      void this.applyLiveStatusFromFetch();
      this.start();
    });
  }

  private async applyLiveStatusFromFetch(): Promise<void> {
    try {
      const res = await fetch(`/live-status.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) {
        this.syncDynamicGrunts();
        return;
      }
      this.applyLiveStatus((await res.json()) as LiveStatusSnapshot);
    } catch {
      this.syncDynamicGrunts();
    }
  }

  private async loadSprites(): Promise<void> {
    await assetLoader.loadManifest();
    const manifest = assetLoader.getManifest();
    const mapMeta = manifest?.map;
    if (mapMeta?.width && mapMeta?.height && mapMeta?.tileSize) {
      gameMap.applyBakedDimensions(mapMeta.width, mapMeta.height, mapMeta.tileSize);
    }
    const hqPath = mapMeta?.file ? `/assets/${mapMeta.file}` : null;
    if (hqPath) {
      const hqData = await loadMapData(hqPath);
      if (hqData) {
        gameMap.replaceData(hqData);
      }
    } else if (mapMeta?.width && mapMeta?.height && mapMeta?.tileSize) {
      gameMap.applyBakedDimensions(mapMeta.width, mapMeta.height, mapMeta.tileSize);
    }

    const collisionPath = assetLoader.getMapCollisionPath();
    this.collisionRequired = Boolean(collisionPath);
    const [sprites, mapBackground, mapWalkover, mapMid, mapWallsFront, mapOverlay, mapGrid, mapActions] =
      await Promise.all([
      assetLoader.loadAllAgentSprites(this.state.agents.map(agent => agent.id)),
      assetLoader.loadMapBackground(),
      assetLoader.loadMapWalkover(),
      assetLoader.loadMapMid(),
      assetLoader.loadMapWallsFront(),
      assetLoader.loadMapOverlay(),
      collisionPath ? assetLoader.loadMapCollision() : Promise.resolve(null),
      assetLoader.loadMapActions(),
    ]);
    this.mapGrid = mapGrid;
    if (this.collisionRequired && !this.mapGrid) {
      console.error('Map collision failed to load; agents will not walk through furniture.');
    }
    const walkoverTiles = (await this.extractWalkoverTiles()) ?? [];
    const midTiles = (await this.extractMidTiles()) ?? [];
    const wallsFrontTiles = (await this.extractWallsFrontTiles()) ?? [];
    if (mapActions?.tiles.length) {
      await loadActionSpotsFromMap(mapActions.tiles);
    }
    this.renderer.setSprites(sprites);
    this.renderer.setMapBackground(mapBackground);
    this.renderer.setMapWalkover(mapWalkover, walkoverTiles);
    this.renderer.setMapMid(mapMid, midTiles);
    this.renderer.setMapWallsFront(mapWallsFront, wallsFrontTiles);
    this.renderer.setMapOverlay(mapOverlay);
  }

  private async extractWalkoverTiles(): Promise<Array<{ x: number; y: number }> | null> {
    return this.extractCollisionTileList('walkoverTiles');
  }

  private async extractMidTiles(): Promise<Array<{ x: number; y: number }> | null> {
    return this.extractCollisionTileList('midTiles');
  }

  private async extractWallsFrontTiles(): Promise<Array<{ x: number; y: number }> | null> {
    return this.extractCollisionTileList('wallsFrontTiles');
  }

  private async extractCollisionTileList(
    key: 'walkoverTiles' | 'midTiles' | 'wallsFrontTiles'
  ): Promise<Array<{ x: number; y: number }> | null> {
    const collisionPath = assetLoader.getMapCollisionPath();
    if (!collisionPath) return null;
    const rev = assetLoader.getManifest()?.map?.collisionRev ?? '1';
    try {
      const res = await fetch(`/assets/${collisionPath}?v=${rev}`);
      if (!res.ok) return null;
      const data = (await res.json()) as Record<
        string,
        Array<{ x: number; y: number }> | undefined
      >;
      return data[key]?.map((t) => ({ x: t.x, y: t.y })) ?? null;
    } catch {
      return null;
    }
  }

  private placeAgents(): void {
    const layout = this.renderer.getLayout();
    for (const agent of this.state.agents) {
      if (
        agent.id === 'cursor' &&
        (this.cursorTerminalInUse() ||
          this.agentDismissing.has('cursor') ||
          this.agentTerminalMarch.has('cursor'))
      ) {
        continue;
      }
      if (
        (agent.id === 'cursor' ||
          agent.id === 'cursor-grunt' ||
          agent.id === 'bumblebee') &&
        agent.visibleOnMap === false
      ) {
        continue;
      }
      if (agent.id === 'bumblebee' && agent.status === 'working' && agent.statusSource === 'cursor') {
        continue;
      }
      const footTile = this.resolveSpawnFootTile(agent.id);
      if (!footTile) continue;
      const point = this.spawnPixels(layout, footTile.x, footTile.y, agent.id);
      agent.x = point.x;
      agent.y = point.y;
      agent.targetX = point.x;
      agent.targetY = point.y;
    }
    if (this.mapReady) {
      this.syncDynamicGrunts();
    }
  }

  private resolveSpawnFootTile(agentId: string): TileCoord | null {
    const preferred = gameMap.getAgentSpawnTile(agentId);
    const agent = this.state.agents.find((a) => a.id === agentId);
    if (!agent) return preferred ?? null;
    
    if (preferred) {
      if (this.canOccupyTile(preferred.x, preferred.y, agent)) {
        return preferred;
      }
      return this.findNearestWalkableFootTile(agent, preferred);
    }
    
    // No spawn point defined - find any walkable tile (never use random pixels)
    const walkable = this.getAllWalkableTiles(agent);
    if (walkable.length > 0) {
      const idx = Math.floor(Math.random() * walkable.length);
      const tile = walkable[idx];
      return tile ?? null;
    }
    return null;
  }

  private findNearestWalkableFootTile(agent: Agent, preferred: TileCoord): TileCoord | null {
    // Try room tiles first, fall back to all walkable tiles if agent has no room
    let candidates = this.getWalkableTilesInRoom(agent);
    if (candidates.length === 0) {
      candidates = this.getAllWalkableTiles(agent);
    }
    if (candidates.length === 0) return null;
    let best = candidates[0];
    let bestDist = Number.POSITIVE_INFINITY;
    for (const tile of candidates) {
      const dist = Math.abs(tile.x - preferred.x) + Math.abs(tile.y - preferred.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = tile;
      }
    }
    return best;
  }

  private spawnPixels(
    layout: MapLayout,
    tileX: number,
    tileY: number,
    agentId: string
  ): { x: number; y: number } {
    const size = this.renderer.spritePixelSize(agentId);
    const footCenterX = layout.offsetX + tileX * layout.tile + layout.tile / 2;
    return {
      x: Math.round(footCenterX - size.width / 2),
      y: Math.round(layout.offsetY + (tileY + 1) * layout.tile - size.height),
    };
  }

  private setupEventListeners(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = e.clientX - rect.left;
      this.mouseY = e.clientY - rect.top;
      
      const hoveredAgent = this.renderer.getAgentAtPosition(this.state.agents, this.mouseX, this.mouseY);
      this.state.hoveredAgent = hoveredAgent?.id || null;
      canvas.style.cursor = hoveredAgent ? 'pointer' : 'default';
    });
    
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const clickedAgent = this.renderer.getAgentAtPosition(this.state.agents, x, y);
      this.state.selectedAgent = clickedAgent?.id || null;
      
      if (this.onAgentSelect) {
        this.onAgentSelect(clickedAgent);
      }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
      this.placeAgents();
    });
  }
  
  setOnAgentSelect(callback: (agent: Agent | null) => void): void {
    this.onAgentSelect = callback;
  }
  
  setOnTaskComplete(callback: (task: Task) => void): void {
    this.onTaskComplete = callback;
  }
  
  private start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame((time) => this.gameLoop(time));
  }
  
  private gameLoop(currentTime: number): void {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    this.update(deltaTime);
    this.render();
    
    requestAnimationFrame((time) => this.gameLoop(time));
  }
  
  private update(deltaTime: number): void {
    if (!this.mapReady) return;
    this.syncDynamicGrunts();
    const now = Date.now();

    for (const agent of this.state.agents) {
      if (!this.isAgentSimulated(agent)) {
        continue;
      }
      this.moveAgent(agent);
      this.settleAgentAtRest(agent);
      this.updateAgentLocomotion(agent);

      const nowMs = Date.now();
      if (agent.locomotion === 'walk') {
        this.agentIdleSince.set(agent.id, nowMs);
        this.agentWasMoving.set(agent.id, true);
        agent.idleFrame = 0;
        agent.idleTimer = 0;
        agent.frameTimer += deltaTime;
        if (agent.frameTimer >= FRAME_DURATION) {
          agent.frameTimer = 0;
          agent.frame = (agent.frame + 1) % 4;
        }
      } else {
        agent.frame = 0;
        agent.frameTimer = 0;
        if (!this.agentIdleSince.has(agent.id)) {
          this.agentIdleSince.set(agent.id, nowMs);
        }
        if (this.agentWasMoving.get(agent.id)) {
          this.agentWasMoving.set(agent.id, false);
          agent.idleFrame = 0;
          agent.idleTimer = 0;
        }
      }
      this.applyWorkFacingIfArrived(agent);
      this.tryFinishGruntDismiss(agent);
      this.advanceCursorTerminalMarch(agent);

      if (
        this.mapReady &&
        agent.id === 'cursor' &&
        this.cursorTerminalInUse() &&
        !this.footMatchesTile(agent, CURSOR_TERMINAL_GRUNT_TILE.x, CURSOR_TERMINAL_GRUNT_TILE.y) &&
        !this.agentDismissing.has('cursor') &&
        !this.agentTerminalMarch.has('cursor')
      ) {
        this.syncTerminalGrunt(true);
      }

      if (
        agent.status !== 'working' &&
        !this.agentPostedAtTerminal.has(agent.id) &&
        !this.agentDismissing.has(agent.id) &&
        !this.agentTerminalMarch.has(agent.id)
      ) {
        this.updateNpcBehavior(agent, now);
      }
      
      // Simulate task completion
      if (agent.currentTask && agent.status === 'working') {
        const taskDuration = 5000 + Math.random() * 5000; // 5-10 seconds
        const taskAge = now - agent.currentTask.createdAt.getTime();
        
        if (taskAge > taskDuration) {
          this.completeAgentTask(agent);
        }
      }
    }
  }
  

  private footTileOfAgent(agent: Agent): TileCoord {
    const { tileXs, footTileY } = this.footTilesFromPixels(agent, agent.x, agent.y);
    return { x: tileXs[0], y: footTileY };
  }

  /** Per-agent feet Y position in pixels, used for depth sorting. */
  private agentFeetY(agent: Agent): number {
    const size = this.renderer.spritePixelSize(agent.id);
    return agent.y + size.height;
  }

  private canEnterFootTile(tileX: number, footTileY: number, agent: Agent): boolean {
    if (this.mapGrid && !this.mapGrid.isBlockedForFootprint([tileX], footTileY)) {
      return true;
    }
    if (!this.mapGrid) {
      const probe = this.spawnPixels(this.renderer.getLayout(), tileX, footTileY, agent.id);
      return this.canOccupy(agent, probe.x, probe.y);
    }
    return false;
  }

  private canOccupyTile(tileX: number, footTileY: number, agent: Agent): boolean {
    const pos = this.spawnPixels(this.renderer.getLayout(), tileX, footTileY, agent.id);
    return this.canOccupy(agent, pos.x, pos.y) && this.canEnterFootTile(tileX, footTileY, agent);
  }

  private setAgentsIdleAtCurrentPosition(): void {
    const now = Date.now();
    for (const agent of this.state.agents) {
      agent.targetX = agent.x;
      agent.targetY = agent.y;
      this.agentTilePaths.set(agent.id, []);
      this.wanderTimers.set(agent.id, now + Math.random() * NPC_INITIAL_DELAY_MAX_MS);
    }
  }

  private occupiedWorkFootTiles(excludingAgentId: string): Set<string> {
    const keys = new Set<string>();
    for (const [agentId, tile] of this.agentWorkTile) {
      if (agentId === excludingAgentId) continue;
      keys.add(`${tile.x},${tile.y}`);
    }
    return keys;
  }

  private releaseWorkTile(agentId: string): void {
    this.agentWorkTile.delete(agentId);
  }

  private goToActionSpot(
    agent: Agent,
    task?: Task | null,
    liveActivity?: LiveCursorActivity,
    liveDepth: LiveActivityDepth = 'brief'
  ): void {
    const kind = liveActivity
      ? actionKindFromLiveActivity(liveActivity, agent, liveDepth)
      : classifyWorkAction(agent, task ?? agent.currentTask);
    const spot = pickActionSpot(agent, kind, this.occupiedWorkFootTiles(agent.id));
    if (!spot) return;

    this.agentWorkTile.set(agent.id, { x: spot.x, y: spot.y });
    this.agentWorkFacing.set(agent.id, spot.facing);
    const start = this.footTileOfAgent(agent);
    const goal = { x: spot.x, y: spot.y };
    if (this.mapGrid) {
      const path = findTilePath(start, goal, (x, y) => this.canEnterFootTile(x, y, agent));
      if (path) {
        this.setAgentPath(agent, path);
        return;
      }
    }
    const pos = this.spawnPixels(this.renderer.getLayout(), spot.x, spot.y, agent.id);
    agent.targetX = pos.x;
    agent.targetY = pos.y;
    this.agentTilePaths.set(agent.id, []);
  }

  /** Re-center on assigned work tile after pathing (avoids half-tile drift from movement). */
  private alignAgentToAssignedWorkTile(agent: Agent): void {
    const work = this.agentWorkTile.get(agent.id);
    if (!work) return;
    const foot = this.footTileOfAgent(agent);
    if (foot.x !== work.x || foot.y !== work.y) return;
    const pos = this.spawnPixels(this.renderer.getLayout(), work.x, work.y, agent.id);
    agent.x = pos.x;
    agent.y = pos.y;
    agent.targetX = pos.x;
    agent.targetY = pos.y;
  }

  private applyWorkFacingIfArrived(agent: Agent): void {
    if (agent.status !== 'working' && !this.agentPostedAtTerminal.has(agent.id)) return;
    if (this.agentTerminalMarch.has(agent.id) || this.agentDismissing.has(agent.id)) {
      return;
    }
    const work = this.agentWorkTile.get(agent.id);
    if (work) {
      const foot = this.footTileOfAgent(agent);
      if (foot.x !== work.x || foot.y !== work.y) {
        return;
      }
    }
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length > 0) return;
    const dist = Math.hypot(agent.targetX - agent.x, agent.targetY - agent.y);
    if (dist >= 2) return;
    this.alignAgentToAssignedWorkTile(agent);
    const facing = this.agentWorkFacing.get(agent.id);
    if (facing) {
      agent.direction = facing;
      agent.targetX = agent.x;
      agent.targetY = agent.y;
      agent.frame = 0;
      agent.frameTimer = 0;
    }
  }

  /**
   * Stand vs walk is based on tile path + arrival, not raw target drift (which kept walk1 idle).
   */
  private updateAgentLocomotion(agent: Agent): void {
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length > 0) {
      agent.locomotion = 'walk';
      return;
    }
    const dist = Math.hypot(agent.targetX - agent.x, agent.targetY - agent.y);
    if (dist > ARRIVE_EPSILON) {
      agent.locomotion = 'walk';
      return;
    }
    agent.locomotion = 'stand';
    agent.targetX = agent.x;
    agent.targetY = agent.y;
    agent.frame = 0;
  }

  /** Snap position/target when path is done so idle pose is not stuck in walk cycle. */
  private settleAgentAtRest(agent: Agent): void {
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length > 0) return;
    const dist = Math.hypot(agent.targetX - agent.x, agent.targetY - agent.y);
    if (dist >= ARRIVE_EPSILON) return;
    if (dist > 0.01) {
      this.snapAgentToTarget(agent);
      return;
    }
    agent.targetX = agent.x;
    agent.targetY = agent.y;
  }

  /** Spawn tile when a new grunt is added (Actions layer markers). */
  getGruntSpawnFootTile(team: 'cursor' | 'claude'): { x: number; y: number } | null {
    const spot = getGruntSpawnSpot(team);
    return spot ? { x: spot.x, y: spot.y } : null;
  }

  private ensureAgentsOnWalkableTiles(): void {
    const layout = this.renderer.getLayout();
    for (const agent of this.state.agents) {
      if (this.canOccupy(agent, agent.x, agent.y)) continue;
      const preferred = gameMap.getAgentSpawnTile(agent.id) ?? this.footTileOfAgent(agent);
      const pick = this.findNearestWalkableFootTile(agent, preferred);
      if (!pick) continue;
      const pos = this.spawnPixels(layout, pick.x, pick.y, agent.id);
      agent.x = pos.x;
      agent.y = pos.y;
      agent.targetX = pos.x;
      agent.targetY = pos.y;
    }
  }

  private setAgentPath(agent: Agent, path: TileCoord[]): void {
    this.agentTilePaths.set(agent.id, path);
    this.agentStuckFrames.set(agent.id, 0);
    this.syncTargetToPath(agent);
  }

  private syncTargetToPath(agent: Agent): void {
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length === 0) {
      agent.targetX = agent.x;
      agent.targetY = agent.y;
      return;
    }
    const next = path[0];
    const pos = this.spawnPixels(this.renderer.getLayout(), next.x, next.y, agent.id);
    agent.targetX = pos.x;
    agent.targetY = pos.y;
  }

  private advancePathIfReached(agent: Agent): void {
    const dx = agent.targetX - agent.x;
    const dy = agent.targetY - agent.y;
    if (Math.sqrt(dx * dx + dy * dy) >= ARRIVE_EPSILON) return;
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length === 0) {
      this.snapAgentToTarget(agent);
      return;
    }
    path.shift();
    this.agentTilePaths.set(agent.id, path);
    this.syncTargetToPath(agent);
    if (path.length === 0) {
      this.snapAgentToTarget(agent);
      this.alignAgentToAssignedWorkTile(agent);
      this.tryMarkTerminalGruntPosted(agent);
      if (agent.status !== 'working' && !this.agentPostedAtTerminal.has(agent.id)) {
        this.wanderTimers.set(agent.id, Date.now() + randomNpcPauseMs());
      }
    }
  }

  /** Snap to target and reset walk cycle so idle uses the idle column (pose 1). */
  private snapAgentToTarget(agent: Agent): void {
    agent.x = agent.targetX;
    agent.y = agent.targetY;
    agent.frame = 0;
    agent.frameTimer = 0;
    agent.idleFrame = 0;
    agent.idleTimer = 0;
    this.agentMoveAxis.delete(agent.id);
  }


  private updateNpcBehavior(agent: Agent, now: number): void {
    if (agent.id === 'cursor' && this.cursorTerminalInUse()) {
      return;
    }
    const path = this.agentTilePaths.get(agent.id) ?? [];
    const dist = Math.hypot(agent.targetX - agent.x, agent.targetY - agent.y);
    if (path.length > 0 || dist > 2) {
      return;
    }

    const nextAt = this.wanderTimers.get(agent.id) ?? 0;
    if (now < nextAt) {
      return;
    }

    if (Math.random() < NPC_LOOK_AROUND_CHANCE) {
      agent.direction = randomLookDirection();
      agent.targetX = agent.x;
      agent.targetY = agent.y;
      this.agentTilePaths.set(agent.id, []);
      this.wanderTimers.set(agent.id, now + randomNpcPauseMs());
      return;
    }

    const walked = this.pickNpcShortWalk(agent, now);
    if (!walked) {
      agent.direction = randomLookDirection();
      this.wanderTimers.set(agent.id, now + randomNpcPauseMs());
      return;
    }

    this.wanderTimers.set(agent.id, now + randomNpcPauseMs() + 4_000);
  }

  private mayRoamOutsideHome(agent: Agent, now: number): boolean {
    const group = agentGroup(agent.id);
    if (group !== 'cursor' && group !== 'claude') return true;
    const idleSince = this.agentIdleSince.get(agent.id) ?? now;
    return now - idleSince >= HOME_ROAM_IDLE_MS;
  }

  private getWalkableTilesForAgent(agent: Agent, now: number): Array<{ x: number; y: number }> {
    if (this.mapGrid && this.mayRoamOutsideHome(agent, now)) {
      return this.getAllWalkableTiles(agent);
    }
    return this.getWalkableTilesInRoom(agent);
  }

  private getAllWalkableTiles(agent: Agent): Array<{ x: number; y: number }> {
    if (!this.mapGrid) return [];
    const tiles: Array<{ x: number; y: number }> = [];
    for (let ty = 0; ty < this.mapGrid.height; ty++) {
      for (let tx = 0; tx < this.mapGrid.width; tx++) {
        if (!this.canOccupyTile(tx, ty, agent)) continue;
        tiles.push({ x: tx, y: ty });
      }
    }
    return tiles;
  }

  private pickNpcShortWalk(agent: Agent, now: number): boolean {
    const walkable = this.getWalkableTilesForAgent(agent, now);
    const start = this.footTileOfAgent(agent);
    const goal = pickShortWalkGoal(start, walkable);
    if (!goal) {
      return false;
    }

    if (this.mapGrid) {
      const full = findTilePath(start, goal, (x, y) => this.canEnterFootTile(x, y, agent));
      if (!full || full.length === 0) {
        return false;
      }
      const path = truncatePath(full, NPC_WALK_TILES_MAX);
      this.setAgentPath(agent, path);
      return true;
    }

    const pos = this.spawnPixels(this.renderer.getLayout(), goal.x, goal.y, agent.id);
    agent.targetX = pos.x;
    agent.targetY = pos.y;
    this.agentTilePaths.set(agent.id, []);
    return true;
  }

  private pickNewDestination(agent: Agent): void {
    if (!this.mapReady) return;
    const walkable = this.getWalkableTilesInRoom(agent);
    if (walkable.length === 0) {
      this.agentTilePaths.set(agent.id, []);
      agent.targetX = agent.x;
      agent.targetY = agent.y;
      return;
    }

    const start = this.footTileOfAgent(agent);
    for (let attempt = 0; attempt < 12; attempt++) {
      const pick = walkable[Math.floor(Math.random() * walkable.length)];
      if (pick.x === start.x && pick.y === start.y) continue;
      if (this.mapGrid) {
        const path = findTilePath(start, pick, (x, y) => this.canEnterFootTile(x, y, agent));
        if (path && path.length > 0) {
          this.setAgentPath(agent, path);
          return;
        }
      } else {
        const pos = this.spawnPixels(this.renderer.getLayout(), pick.x, pick.y, agent.id);
        agent.targetX = pos.x;
        agent.targetY = pos.y;
        this.agentTilePaths.set(agent.id, []);
        return;
      }
    }

    this.agentTilePaths.set(agent.id, []);
    agent.targetX = agent.x;
    agent.targetY = agent.y;
  }
  
  private resolveMoveAxis(agent: Agent, dx: number, dy: number): 'x' | 'y' {
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    let axis = this.agentMoveAxis.get(agent.id);

    if (absDx < 2) axis = 'y';
    else if (absDy < 2) axis = 'x';
    else if (!axis) axis = absDx > absDy ? 'x' : 'y';
    else if (axis === 'x' && absDx < 2) axis = 'y';
    else if (axis === 'y' && absDy < 2) axis = 'x';

    this.agentMoveAxis.set(agent.id, axis ?? (absDx >= absDy ? 'x' : 'y'));
    return this.agentMoveAxis.get(agent.id)!;
  }

  private moveAgent(agent: Agent): void {
    if (!this.mapReady) return;

    this.advancePathIfReached(agent);

    const dx = agent.targetX - agent.x;
    const dy = agent.targetY - agent.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < ARRIVE_EPSILON) {
      this.snapAgentToTarget(agent);
      return;
    }

    const speed = agent.status === 'working' ? WORK_MOVE_SPEED : MOVE_SPEED;
    const axis = this.resolveMoveAxis(agent, dx, dy);

    const stepX = dx === 0 ? 0 : dx > 0 ? Math.min(speed, dx) : Math.max(-speed, dx);
    const stepY = dy === 0 ? 0 : dy > 0 ? Math.min(speed, dy) : Math.max(-speed, dy);

    const tryStep = (mx: number, my: number): boolean => {
      if (mx === 0 && my === 0) return false;
      const nx = agent.x + mx;
      const ny = agent.y + my;
      if (!this.canOccupy(agent, nx, ny)) return false;
      agent.x = nx;
      agent.y = ny;
      this.agentStuckFrames.set(agent.id, 0);
      return true;
    };

    if (axis === 'x') {
      agent.direction = dx > 0 ? 'right' : 'left';
      if (tryStep(stepX, 0)) return;
      if (tryStep(0, stepY)) return;
    } else {
      agent.direction = dy > 0 ? 'down' : 'up';
      if (tryStep(0, stepY)) return;
      if (tryStep(stepX, 0)) return;
    }

    const stuck = (this.agentStuckFrames.get(agent.id) ?? 0) + 1;
    this.agentStuckFrames.set(agent.id, stuck);
    if (stuck === 1) {
      this.agentMoveAxis.delete(agent.id);
    }
    if (stuck >= 10) {
      this.agentStuckFrames.set(agent.id, 0);
      this.agentMoveAxis.delete(agent.id);
      this.agentTilePaths.set(agent.id, []);
      if (!this.agentTerminalMarch.has(agent.id)) {
        this.agentNavGoal.delete(agent.id);
        agent.targetX = agent.x;
        agent.targetY = agent.y;
        agent.frame = 0;
        this.wanderTimers.set(agent.id, Date.now() + randomNpcPauseMs());
      }
    }
    if (stuck >= 30) {
      this.agentStuckFrames.set(agent.id, 0);
      this.pickNewDestination(agent);
    }
  }

  private footTilesFromPixels(agent: Agent, x: number, y: number): { tileXs: number[]; footTileY: number } {
    const layout = this.renderer.getLayout();
    const size = this.renderer.spritePixelSize(agent.id);
    const footY = y + size.height - 1;
    const footCenterX = x + size.width / 2;
    const footTileX = Math.floor((footCenterX - layout.offsetX) / layout.tile);
    const footTileY = Math.floor((footY - layout.offsetY) / layout.tile);
    return { tileXs: [footTileX], footTileY };
  }

  private canOccupy(agent: Agent, x: number, y: number): boolean {
    if (this.collisionRequired && !this.mapGrid) {
      return false;
    }
    if (!this.mapGrid) {
      return true;
    }
    const { tileXs, footTileY } = this.footTilesFromPixels(agent, x, y);
    if (this.mapGrid.isBlockedForFootprint(tileXs, footTileY)) {
      return false;
    }
    return !this.isFootprintOccupiedByOtherAgent(tileXs, footTileY, agent.id);
  }

  private isFootprintOccupiedByOtherAgent(
    tileXs: number[],
    footTileY: number,
    selfId: string
  ): boolean {
    for (const other of this.state.agents) {
      if (other.id === selfId) continue;
      const foot = this.footTileOfAgent(other);
      if (foot.y !== footTileY) continue;
      if (tileXs.some((tx) => tx === foot.x)) {
        return true;
      }
    }
    return false;
  }

  private getWalkableTilesInRoom(agent: Agent): Array<{ x: number; y: number }> {
    const room = gameMap.getRoomForAgent(agent.id);
    if (!room) return [];
    const tiles: Array<{ x: number; y: number }> = [];
    for (let ty = room.y + 1; ty < room.y + room.height; ty++) {
      for (let tx = room.x; tx < room.x + room.width; tx++) {
        if (!this.canEnterFootTile(tx, ty, agent)) continue;
        if (!this.canOccupyTile(tx, ty, agent)) continue;
        tiles.push({ x: tx, y: ty });
      }
    }
    return tiles;
  }

  private render(): void {
    this.renderer.clear();
    
    // Draw connections between coordinators and subagents
    this.renderer.drawAgentConnections(this.state.agents);
    
    const layout = this.renderer.getLayout();
    
    // Rendering order (see renderQueue.ts for layer constants):
    //   1. Background (floor/grass/walls) - baked into mapBackground, drawn by clear()
    //   2. Furniture-low (walkover) - walkable tiles drawn under avatar
    //   3. ALL SHADOWS - separate pass, always under furniture-mid/wall-front
    //   4. Depth-sorted queue: furniture-mid, avatars
    //   5. Wall-front - ALWAYS on top of avatars and shadows
    //   6. Overlay (furniture-high) - always on top of everything
    //
    // Shadow rule: shadows are drawn in their own pass BEFORE the depth-sorted
    // queue, so they are ALWAYS under furniture-mid and wall-front regardless
    // of Y position. Shadows sit on top of floor/grass/furniture-low only.
    //
    // Wall-front rule: wall-front tiles are drawn AFTER the depth-sorted queue,
    // so they are ALWAYS on top of avatars and their shadows.

    // Build agent render info with per-agent feet positions
    const agents: AgentRenderInfo[] = [];
    for (const agent of this.state.agents) {
      if (!this.isAgentDrawn(agent)) continue;
      const feetY = this.agentFeetY(agent);
      agents.push({
        id: agent.id,
        feetY,
        drawShadow: () => this.renderer.drawAgentShadow(agent),
        drawAgent: () =>
          this.renderer.drawAgent(
            agent,
            agent.id === this.state.selectedAgent,
            false
          ),
      });
    }

    // Build tile render info
    const walkoverTiles: TileRenderInfo[] = this.renderer
      .getWalkoverTiles()
      .map(({ x, y }) => ({
        coord: { x, y },
        sortY: this.renderer.tileFootSortY(layout, y),
        draw: () => this.renderer.drawWalkoverTile(layout, x, y),
      }));

    const midTiles: TileRenderInfo[] = this.renderer
      .getMidTiles()
      .map(({ x, y }) => ({
        coord: { x, y },
        sortY: this.renderer.tileFootSortY(layout, y),
        draw: () => this.renderer.drawMidTile(layout, x, y),
      }));

    const wallsFrontTiles: TileRenderInfo[] = this.renderer
      .getWallsFrontTiles()
      .map(({ x, y }) => ({
        coord: { x, y },
        sortY: this.renderer.tileFootSortY(layout, y),
        draw: () => this.renderer.drawWallsFrontTile(layout, x, y),
      }));

    // PASS 1: Draw furniture-low (walkover) tiles first - these are under shadows
    for (const tile of walkoverTiles) {
      tile.draw();
    }

    // PASS 2: Draw ALL shadows - always under furniture-mid and wall-front
    for (const agent of agents) {
      agent.drawShadow();
    }

    // PASS 3: Depth-sorted queue (furniture-mid, avatars only)
    // Shadows are NOT in this queue, so they're always underneath
    // Wall-front is drawn in a separate pass to be always on top
    const queue = buildSortedRenderQueue(agents, [], midTiles, []);
    for (const item of queue) {
      item.draw();
    }

    // PASS 4: Wall-front tiles - ALWAYS on top of avatars and shadows
    for (const tile of wallsFrontTiles) {
      tile.draw();
    }

    // PASS 5: Overlay (furniture-high) is always drawn on top of everything
    this.renderer.drawMapOverlay(layout);

    if (this.state.selectedAgent) {
      const agent = this.state.agents.find((a) => a.id === this.state.selectedAgent);
      if (agent) {
        this.renderer.drawTooltip(agent, this.mouseX, this.mouseY, this.state.agents);
      }
    }
  }
  
  getAgents(): Agent[] {
    return this.state.agents;
  }
  
  getAgent(id: string): Agent | undefined {
    return this.state.agents.find(a => a.id === id);
  }

  applyActiveTerminalCount(count: number): void {
    this.activeCursorTerminals = Math.max(0, count);
    this.syncDynamicGrunts();
  }

  applyLiveStatus(snapshot: LiveStatusSnapshot): void {
    this.applyActiveTerminalCount(snapshot.activeTerminals ?? 0);

    for (const [agentId, live] of Object.entries(snapshot.agents)) {
      if (agentId === 'cursor' || agentId === 'cursor-grunt') {
        continue;
      }
      const agent = this.state.agents.find(a => a.id === agentId);
      if (!agent || agent.currentTask) continue;

      const stamp = `${live.status}|${live.activity ?? ''}|${live.activityDepth ?? 'brief'}|${live.detail ?? ''}|${snapshot.updatedAt ?? ''}`;
      const isBusy = live.status === 'working' || live.status === 'busy';

      if (isBusy) {
        if (agentId === 'bumblebee') {
          this.agentDismissing.delete('bumblebee');
          agent.visibleOnMap = true;
        }
        if (agent.status !== 'working' || this.liveStatusStamp.get(agentId) !== stamp) {
          agent.status = 'working';
          agent.statusSource = 'cursor';
          agent.statusDetail = live.detail;
          this.goToActionSpot(
            agent,
            null,
            live.activity,
            live.activityDepth ?? 'brief'
          );
        }
      } else if (live.status === 'idle' && agent.statusSource === 'cursor') {
        agent.status = 'idle';
        agent.statusSource = undefined;
        agent.statusDetail = live.detail;
        agent.targetX = agent.x;
        agent.targetY = agent.y;
        this.agentTilePaths.set(agent.id, []);
        this.releaseWorkTile(agent.id);
        this.wanderTimers.set(agent.id, Date.now() + randomNpcPauseMs());
      } else if (!isBusy) {
        agent.statusDetail = live.detail;
      }

      this.liveStatusStamp.set(agentId, stamp);
      if (live.activity) {
        this.liveCursorActivity.set(agentId, live.activity);
      } else if (live.status === 'idle') {
        this.liveCursorActivity.delete(agentId);
      }
    }
  }
  
  assignTaskToAgent(task: Task, agentId: string): void {
    const agent = this.state.agents.find(a => a.id === agentId);
    if (!agent) return;

    this.agentDismissing.delete(agent.id);
    agent.visibleOnMap = true;
    
    agent.status = 'working';
    agent.statusSource = 'local';
    agent.statusDetail = undefined;
    agent.currentTask = task;
    orchestrator.assignTask(task, agentId);
    
    this.goToActionSpot(agent, task);
    this.syncDynamicGrunts();
  }
  
  private completeAgentTask(agent: Agent): void {
    if (agent.currentTask) {
      orchestrator.completeTask(agent.currentTask.id);
      
      if (this.onTaskComplete) {
        this.onTaskComplete(agent.currentTask);
      }
      
      agent.currentTask = null;
    }
    agent.statusSource = undefined;
    agent.statusDetail = undefined;
    agent.status = 'idle';
    agent.targetX = agent.x;
    agent.targetY = agent.y;
    this.agentTilePaths.set(agent.id, []);
    this.releaseWorkTile(agent.id);
    this.wanderTimers.set(agent.id, Date.now() + randomNpcPauseMs());
    this.syncDynamicGrunts();
  }

  private isAgentDrawn(agent: Agent): boolean {
    return agent.visibleOnMap !== false;
  }

  private isAgentSimulated(agent: Agent): boolean {
    if (agent.visibleOnMap !== false) return true;
    return (
      this.agentDismissing.has(agent.id) || this.agentTerminalMarch.has(agent.id)
    );
  }

  /** True only when hooks report an active integrated terminal (shell in flight). */
  private cursorTerminalInUse(): boolean {
    return this.activeCursorTerminals > 0;
  }

  private fridayNeedsSubagent(): boolean {
    const friday = this.getAgent('friday');
    const bumblebee = this.getAgent('bumblebee');
    if (friday?.status === 'working' && friday.statusSource === 'cursor') return true;
    if (bumblebee?.status === 'working' && bumblebee.statusSource === 'cursor') return true;
    return false;
  }

  private syncDynamicGrunts(): void {
    if (!this.mapReady) return;
    this.syncTerminalGrunt(this.cursorTerminalInUse());
    this.syncFridaySubagent(this.fridayNeedsSubagent());
    this.syncSecondaryCursorGrunt();
  }

  private pinAgentToFootTile(
    agent: Agent,
    tileX: number,
    tileY: number,
    facing: 'left' | 'right' | 'up' | 'down'
  ): void {
    this.agentTilePaths.set(agent.id, []);
    this.agentNavGoal.delete(agent.id);
    this.agentDismissing.delete(agent.id);
    const pos = this.spawnPixels(this.renderer.getLayout(), tileX, tileY, agent.id);
    agent.x = pos.x;
    agent.y = pos.y;
    agent.targetX = pos.x;
    agent.targetY = pos.y;
    agent.direction = facing;
    agent.frame = 0;
    agent.frameTimer = 0;
    agent.locomotion = 'stand';
  }

  private hideOffMapGrunt(agentId: 'cursor' | 'cursor-grunt' | 'bumblebee'): void {
    const agent = this.getAgent(agentId);
    if (!agent || agent.currentTask) return;
    this.agentDismissing.delete(agentId);
    this.agentTerminalMarch.delete(agentId);
    this.agentPostedAtTerminal.delete(agentId);
    this.agentNavGoal.delete(agentId);
    this.agentTilePaths.set(agentId, []);
    agent.visibleOnMap = false;
    agent.status = 'idle';
    const spot = getGruntSpawnSpot('cursor');
    if (spot) {
      const pos = this.spawnPixels(this.renderer.getLayout(), spot.x, spot.y, agent.id);
      agent.x = pos.x;
      agent.y = pos.y;
      agent.targetX = pos.x;
      agent.targetY = pos.y;
      if (agentId === 'cursor' || agentId === 'cursor-grunt') {
        agent.direction = spot.facing;
      }
    }
  }

  private syncTerminalGrunt(needed: boolean): void {
    const cursor = this.getAgent('cursor');
    if (!cursor) return;
    if (needed) {
      this.deployCursorGruntToTerminal(cursor);
      return;
    }
    if (cursor.currentTask) return;
    cursor.status = 'idle';
    this.agentPostedAtTerminal.delete('cursor');
    this.agentTerminalMarch.delete('cursor');
    this.releaseWorkTile('cursor');
    if (
      cursor.visibleOnMap === false &&
      !this.agentDismissing.has('cursor') &&
      !this.agentTerminalMarch.has('cursor')
    ) {
      return;
    }
    this.dismissGruntToSpawn(cursor);
  }

  /** Spawn at (6, 6) then path to the terminal scientist tile — no teleport. */
  private deployCursorGruntToTerminal(cursor: Agent): void {
    const tile = CURSOR_TERMINAL_GRUNT_TILE;
    const goal = { x: tile.x, y: tile.y };
    cursor.visibleOnMap = true;
    cursor.status = 'working';
    this.agentWorkFacing.set('cursor', tile.facing);
    this.agentWorkTile.set('cursor', { x: tile.x, y: tile.y });
    this.hideOffMapGrunt('cursor-grunt');

    if (this.agentPostedAtTerminal.has('cursor') && this.footMatchesTile(cursor, tile.x, tile.y)) {
      cursor.direction = tile.facing;
      return;
    }

    if (this.isEnRouteTo(cursor, goal)) {
      const path = this.agentTilePaths.get('cursor') ?? [];
      if (path.length > 0 || this.renderer.isAgentMoving(cursor)) {
        return;
      }
    }

    if (this.agentDismissing.has('cursor')) {
      this.agentDismissing.delete('cursor');
      this.agentTilePaths.set('cursor', []);
    }

    const spawn = getGruntSpawnSpot('cursor');
    if (!this.agentTerminalMarch.has('cursor')) {
      this.agentTerminalMarch.add('cursor');
      this.agentPostedAtTerminal.delete('cursor');
      if (spawn) {
        this.pinAgentToFootTile(cursor, spawn.x, spawn.y, spawn.facing);
      }
    }

    if (this.footMatchesTile(cursor, tile.x, tile.y)) {
      this.agentPostedAtTerminal.add('cursor');
      this.agentTerminalMarch.delete('cursor');
      cursor.direction = tile.facing;
      return;
    }

    this.agentNavGoal.set(cursor.id, goal);
    this.routeAgentToFootTile(cursor, tile.x, tile.y);
  }

  private syncFridaySubagent(needed: boolean): void {
    const bumblebee = this.getAgent('bumblebee');
    if (!bumblebee) return;
    if (needed) {
      this.agentDismissing.delete('bumblebee');
      bumblebee.visibleOnMap = true;
      bumblebee.status = 'working';
      bumblebee.statusSource = bumblebee.statusSource ?? 'cursor';
      const spot = pickActionSpot(bumblebee, 'working', this.occupiedWorkFootTiles('bumblebee'));
      if (spot) {
        this.agentWorkTile.set('bumblebee', { x: spot.x, y: spot.y });
        this.agentWorkFacing.set('bumblebee', spot.facing);
        this.pinAgentToFootTile(bumblebee, spot.x, spot.y, spot.facing);
      } else {
        this.goToActionSpot(bumblebee, null);
      }
      return;
    }
    if (bumblebee.currentTask) return;
    bumblebee.status = 'idle';
    bumblebee.statusSource = undefined;
    this.hideOffMapGrunt('bumblebee');
  }

  private syncSecondaryCursorGrunt(): void {
    if (this.cursorTerminalInUse()) {
      this.hideOffMapGrunt('cursor-grunt');
      return;
    }
    const grunt = this.getAgent('cursor-grunt');
    if (!grunt) return;
    if (grunt.currentTask) {
      this.agentDismissing.delete('cursor-grunt');
      grunt.visibleOnMap = true;
      return;
    }
    if (grunt.visibleOnMap === false && !this.agentDismissing.has('cursor-grunt')) {
      return;
    }
    this.dismissGruntToSpawn(grunt);
  }

  private stashOffMapGruntsAtSpawn(): void {
    const spot = getGruntSpawnSpot('cursor');
    if (!spot) return;
    const layout = this.renderer.getLayout();
    for (const id of ['cursor', 'cursor-grunt', 'bumblebee'] as const) {
      const agent = this.getAgent(id);
      if (!agent || agent.visibleOnMap !== false) continue;
      const pos = this.spawnPixels(layout, spot.x, spot.y, agent.id);
      agent.x = pos.x;
      agent.y = pos.y;
      agent.targetX = pos.x;
      agent.targetY = pos.y;
      if (id === 'cursor' || id === 'cursor-grunt') {
        agent.direction = spot.facing;
      }
      this.agentTilePaths.set(agent.id, []);
    }
  }

  private dismissGruntToSpawn(agent: Agent): void {
    if (agent.visibleOnMap === false && !this.agentDismissing.has(agent.id)) return;
    if (this.agentDismissing.has(agent.id)) {
      return;
    }
    const spot = getGruntSpawnSpot('cursor');
    if (!spot) {
      agent.visibleOnMap = false;
      return;
    }
    const foot = this.footTileOfAgent(agent);
    if (foot.x === spot.x && foot.y === spot.y) {
      agent.visibleOnMap = false;
      agent.direction = spot.facing;
      this.agentDismissing.delete(agent.id);
      return;
    }
    this.agentDismissing.add(agent.id);
    this.agentTerminalMarch.delete(agent.id);
    this.agentPostedAtTerminal.delete(agent.id);
    const goal = { x: spot.x, y: spot.y };
    if (this.isEnRouteTo(agent, goal)) return;
    this.agentNavGoal.set(agent.id, goal);
    this.routeAgentToFootTile(agent, spot.x, spot.y);
  }

  private footMatchesTile(agent: Agent, tileX: number, tileY: number): boolean {
    const foot = this.footTileOfAgent(agent);
    return foot.x === tileX && foot.y === tileY;
  }

  private isEnRouteTo(agent: Agent, goal: TileCoord): boolean {
    const nav = this.agentNavGoal.get(agent.id);
    if (!nav || nav.x !== goal.x || nav.y !== goal.y) {
      return false;
    }
    if (this.footMatchesTile(agent, goal.x, goal.y)) {
      return false;
    }
    const path = this.agentTilePaths.get(agent.id) ?? [];
    return path.length > 0 || this.renderer.isAgentMoving(agent);
  }

  private routeAgentToFootTile(agent: Agent, tileX: number, tileY: number): boolean {
    const start = this.footTileOfAgent(agent);
    const goal = { x: tileX, y: tileY };
    if (this.mapGrid) {
      const path = findTilePath(start, goal, (x, y) => this.canEnterFootTile(x, y, agent));
      if (path) {
        this.setAgentPath(agent, path);
        return true;
      }
    }
    const pos = this.spawnPixels(this.renderer.getLayout(), tileX, tileY, agent.id);
    agent.targetX = pos.x;
    agent.targetY = pos.y;
    this.agentTilePaths.set(agent.id, []);
    return false;
  }

  private tryFinishGruntDismiss(agent: Agent): void {
    if (!this.agentDismissing.has(agent.id)) return;
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length > 0) return;
    if (this.renderer.isAgentMoving(agent)) return;
    const spot = getGruntSpawnSpot('cursor');
    if (!spot) return;
    const foot = this.footTileOfAgent(agent);
    if (foot.x !== spot.x || foot.y !== spot.y) return;
    this.agentDismissing.delete(agent.id);
    this.agentNavGoal.delete(agent.id);
    agent.visibleOnMap = false;
    agent.status = 'idle';
    agent.direction = spot.facing;
    agent.targetX = agent.x;
    agent.targetY = agent.y;
  }

  /** Keep routing to the terminal while marching if path was cleared or never set. */
  private advanceCursorTerminalMarch(agent: Agent): void {
    if (agent.id !== 'cursor' || !this.agentTerminalMarch.has('cursor')) return;
    if (!this.cursorTerminalInUse()) return;
    const tile = CURSOR_TERMINAL_GRUNT_TILE;
    if (this.footMatchesTile(agent, tile.x, tile.y)) {
      this.tryMarkTerminalGruntPosted(agent);
      return;
    }
    const path = this.agentTilePaths.get(agent.id) ?? [];
    if (path.length > 0 || this.renderer.isAgentMoving(agent)) {
      return;
    }
    this.agentNavGoal.set(agent.id, { x: tile.x, y: tile.y });
    this.routeAgentToFootTile(agent, tile.x, tile.y);
  }

  private tryMarkTerminalGruntPosted(agent: Agent): void {
    if (agent.id !== 'cursor') return;
    if (!this.cursorTerminalInUse()) return;
    if (!this.footMatchesTile(agent, CURSOR_TERMINAL_GRUNT_TILE.x, CURSOR_TERMINAL_GRUNT_TILE.y)) {
      return;
    }
    this.agentPostedAtTerminal.add('cursor');
    this.agentTerminalMarch.delete('cursor');
    agent.direction = CURSOR_TERMINAL_GRUNT_TILE.facing;
    agent.targetX = agent.x;
    agent.targetY = agent.y;
    agent.frame = 0;
    this.agentNavGoal.delete(agent.id);
  }
  
  selectAgent(agentId: string | null): void {
    this.state.selectedAgent = agentId;
  }
}
