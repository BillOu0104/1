import { EventBus, type AppEvents, type SimulationEvent } from '../events/EventBus';
import {
  detectCollision,
  escapeCandidates,
  isValidSystem,
  type EndReason,
} from '../physics/detection';
import { totalEnergy } from '../physics/gravity';
import { StructuredChaosInitializer } from '../physics/structuredChaos';
import { hashSeed } from '../physics/random';
import {
  copyBodies,
  DEFAULT_PHYSICS,
  UNITS_PER_YEAR,
  type Body,
  type InitialConditionGenerator,
  type Integrator,
  type PhysicsConfig,
} from '../physics/types';
import { VelocityVerlet } from '../physics/velocityVerlet';
import { AdaptiveDopri5, type AdaptiveConfig } from '../physics/adaptive';
import { EncounterTracker, errors, invariants, type Invariants } from '../physics/diagnostics';
import {
  DEFAULT_TIDES,
  TidalMonitor,
  readPlanetTides,
  tidalStepLimit,
  type TidalConfig,
  type TidalReading,
} from '../physics/tides';
export interface SimulationControls {
  paused: boolean;
  speed: number;
  autoRestart: boolean;
}
export interface ScreeningSummary {
  mode: string;
  candidates: number;
  qualified: number;
  fallback: boolean;
  selectedCandidate: number;
  previewYears: number;
  previewSteps: number;
  score: number;
  cpuMs: number;
}
export interface SessionHistory {
  events: readonly SimulationEvent[];
  restartCount: number;
  generation: number;
}
export interface SimulationSnapshot {
  bodies: Body[];
  seed: string;
  time: number;
  years: number;
  generation: number;
  phase: 'running' | 'ended' | 'screening';
  reason: EndReason | null;
  restartIn: number;
  restartCount: number;
  autoRestartBlocked: boolean;
  steps: number;
  droppedTime: number;
  energy: number;
  relativeEnergyError: number;
  events: readonly SimulationEvent[];
  controls: SimulationControls;
  diagnostics: {
    momentumError: number;
    angularMomentumError: number;
    minStep: number;
    lastStep: number;
    rejected: number;
    encounters: number;
    exchanges: number;
    cpuMs: number;
    limited: boolean;
  };
  integrator: string;
  tidal: TidalReading | null;
  screening?: ScreeningSummary;
  waitingForInitial: boolean;
}
export interface EngineOptions {
  config?: Partial<PhysicsConfig>;
  generator?: InitialConditionGenerator;
  integrator?: Integrator;
  adaptive?: false | Partial<AdaptiveConfig>;
  tides?: Partial<TidalConfig>;
  events?: EventBus<AppEvents>;
  initialBodies?: Body[];
  restartProvider?: (seed: string) => Body[] | null;
  session?: SessionHistory;
}
export class SimulationEngine {
  readonly config: PhysicsConfig;
  readonly events: EventBus<AppEvents>;
  private bodies: Body[] = [];
  private seed = '';
  private time = 0;
  private accumulator = 0;
  private macroRemaining = 0;
  private wallTime = 0;
  private generation = 0;
  private restartCount = 0;
  private steps = 0;
  private droppedTime = 0;
  private initial!: Invariants;
  private reason: EndReason | null = null;
  private endedAt = 0;
  private nextRestartAt = 0;
  private recentRestarts: number[] = [];
  private autoRestartBlocked = false;
  private escaping = new Map<string, number>();
  private history: SimulationEvent[] = [];
  private eventId = 0;
  private controls: SimulationControls = { paused: false, speed: 1, autoRestart: true };
  private readonly generator: InitialConditionGenerator;
  private readonly integrator: Integrator;
  private readonly adaptive: AdaptiveDopri5 | null;
  private readonly tideModel: TidalConfig;
  private readonly tideMonitor = new TidalMonitor();
  private tidal: TidalReading | null = null;
  private encounters = new EncounterTracker();
  private minStep = Infinity;
  private lastStep = 0;
  private cpuMs = 0;
  private limited = false;
  private waitingForInitial = false;
  constructor(
    seed = 'TRISOLARIS-001',
    private readonly options: EngineOptions = {},
  ) {
    this.config = { ...DEFAULT_PHYSICS, ...options.config };
    const c = this.config;
    if (
      ![
        c.gravitationalConstant,
        c.timeStep,
        c.escapeDistance,
        c.escapeConfirmationTime,
        c.unitsPerSecond,
      ].every((v) => Number.isFinite(v) && v > 0) ||
      !Number.isFinite(c.softening) ||
      c.softening < 0 ||
      !Number.isInteger(c.maxStepsPerFrame) ||
      c.maxStepsPerFrame < 1
    )
      throw new Error('Invalid physics configuration');
    this.generator = options.generator ?? new StructuredChaosInitializer();
    this.integrator = options.integrator ?? new VelocityVerlet();
    this.adaptive =
      options.adaptive === false || options.integrator
        ? null
        : new AdaptiveDopri5(options.adaptive || {});
    this.tideModel = { ...DEFAULT_TIDES, ...options.tides };
    this.events = options.events ?? new EventBus<AppEvents>();
    if (options.session) {
      this.history = [...options.session.events];
      this.restartCount = options.session.restartCount;
      this.generation = options.session.generation;
      this.eventId = Math.max(0, ...this.history.map((e) => e.id));
    }
    this.start(seed, 'started', options.initialBodies);
  }
  getBodies(): readonly Body[] {
    return this.bodies;
  }
  getTime(): number {
    return this.time;
  }
  getGeneration(): number {
    return this.generation;
  }
  getReason(): EndReason | null {
    return this.reason;
  }
  nextSeed(): string {
    return String(hashSeed(`${this.seed}:next`));
  }
  getInterpolationAlpha(): number {
    return this.accumulator / (this.adaptive?.options.maxStep ?? this.config.timeStep);
  }
  setControls(patch: Partial<SimulationControls>): void {
    if (
      patch.speed !== undefined &&
      (!Number.isFinite(patch.speed) || patch.speed < 0.1 || patch.speed > 20)
    )
      throw new Error('Speed must be 0.1–20');
    if (patch.paused !== undefined && patch.paused !== this.controls.paused) {
      this.accumulator = 0;
      this.macroRemaining = 0;
    }
    this.controls = {
      paused: patch.paused ?? this.controls.paused,
      speed: patch.speed ?? this.controls.speed,
      autoRestart: patch.autoRestart ?? this.controls.autoRestart,
    };
  }
  reset(seed = this.seed, bodies?: Body[]): void {
    this.autoRestartBlocked = false;
    this.recentRestarts = [];
    this.restartCount++;
    this.start(seed, 'reset', bodies);
  }
  warn(message: string): void {
    this.record('warning', message);
  }
  private record(type: SimulationEvent['type'], message: string): void {
    const event: SimulationEvent = {
      id: ++this.eventId,
      type,
      seed: this.seed,
      years: this.time / UNITS_PER_YEAR,
      message,
      ...(type === 'ended' && this.reason ? { reason: { ...this.reason } } : {}),
    };
    this.history = [event, ...this.history].slice(0, 200);
    this.events.emit('simulation', event);
  }
  private start(seed: string, type: 'started' | 'reset', prepared?: Body[]): void {
    this.seed = seed;
    this.time = 0;
    this.steps = 0;
    this.accumulator = 0;
    this.macroRemaining = 0;
    this.droppedTime = 0;
    this.minStep = Infinity;
    this.lastStep = 0;
    this.cpuMs = 0;
    this.reason = null;
    this.escaping.clear();
    this.generation++;
    this.waitingForInitial = false;
    this.bodies = prepared ? copyBodies(prepared) : this.generator.generate(seed, this.config);
    this.integrator.reset?.();
    this.adaptive?.reset();
    this.tideMonitor.reset();
    this.encounters = new EncounterTracker();
    this.initial = invariants(this.bodies, this.config);
    this.tidal = this.tideModel.enabled
      ? readPlanetTides(this.bodies, this.config, this.tideModel)
      : null;
    this.record(type, type === 'started' ? '新一轮引力模拟已开始' : '已重置初始条件');
    this.checkSystem();
  }
  private end(reason: EndReason): void {
    if (this.reason) return;
    this.reason = { ...reason, year: this.time / UNITS_PER_YEAR };
    this.endedAt = this.wallTime;
    this.nextRestartAt = Math.max(this.wallTime + 2, (this.recentRestarts.at(-1) ?? -Infinity) + 8);
    this.record('ended', reason.message);
    this.events.emit('termination', this.reason);
    this.events.emit('notification', { title: '模拟结束', body: reason.message });
  }
  private checkSystem(): boolean {
    if (!isValidSystem(this.bodies)) {
      this.end({ type: 'numerical', message: '检测到无效数值，模拟已安全停止', bodyIds: [] });
      return false;
    }
    const collision = detectCollision(this.bodies);
    if (collision) {
      this.end(collision);
      return false;
    }
    return true;
  }
  /** Foreground Worker budget is optional; tests/benchmarks use deterministic step limits. */
  advance(elapsed: number, budgetMs = Infinity): void {
    if (!Number.isFinite(elapsed) || elapsed <= 0 || this.controls.paused) return;
    const started = performance.now(),
      frame = Math.min(elapsed, 0.25);
    this.wallTime += frame;
    this.limited = false;
    if (this.reason) {
      if (
        this.controls.autoRestart &&
        !this.autoRestartBlocked &&
        this.wallTime >= this.nextRestartAt
      ) {
        this.recentRestarts = this.recentRestarts.filter((t) => this.wallTime - t < 30);
        if (this.recentRestarts.length >= 3) {
          this.autoRestartBlocked = true;
          this.record('warning', '短时间内多次结束，自动重启已保护性停止；请手动重置');
        } else {
          const seed = this.nextSeed(),
            prepared = this.options.restartProvider?.(seed);
          if (this.options.restartProvider && !prepared) {
            this.waitingForInitial = true;
            return;
          }
          this.recentRestarts.push(this.wallTime);
          this.restartCount++;
          this.start(seed, 'started', prepared ?? undefined);
        }
      }
      return;
    }
    this.accumulator += frame * this.config.unitsPerSecond * this.controls.speed;
    this.droppedTime += (elapsed - frame) * this.config.unitsPerSecond * this.controls.speed;
    const quantum = this.adaptive?.options.maxStep ?? this.config.timeStep;
    let attempts = 0;
    try {
      while (attempts < this.config.maxStepsPerFrame) {
        if (this.macroRemaining <= 1e-12) {
          if (this.accumulator + 1e-12 < quantum) break;
          this.macroRemaining = quantum;
        }
        if (attempts > 0 && performance.now() - started >= budgetMs) {
          this.limited = true;
          break;
        }
        if (!this.checkSystem()) break;
        const previous = this.bodies.map((b) => [...b.position] as [number, number, number]);
        const saved = this.adaptive ? copyBodies(this.bodies) : null;
        let dt = this.config.timeStep;
        attempts++;
        if (this.adaptive) {
          const result = this.adaptive.attempt(
            this.bodies,
            this.macroRemaining,
            this.config,
            tidalStepLimit(this.tidal),
          );
          if (!result.accepted) continue;
          dt = result.dt;
        } else this.integrator.step(this.bodies, dt, this.config);
        if (!isValidSystem(this.bodies)) {
          this.end({ type: 'numerical', message: '积分器产生无效数值，已停止', bodyIds: [] });
          break;
        }
        const endCollision = detectCollision(this.bodies),
          swept = detectCollision(this.bodies, previous);
        // A curved path's chord can falsely intersect a surface. Refine before making a physical claim.
        if (this.adaptive && swept && !endCollision && dt > this.adaptive.options.minStep * 4) {
          this.bodies = saved!;
          this.adaptive.refine(dt);
          continue;
        }
        const error = errors(this.initial, this.bodies, this.config);
        if (
          this.adaptive &&
          (!Number.isFinite(error.energy) ||
            Math.abs(error.energy) > 1e-4 ||
            error.angularMomentum > 1e-5 ||
            error.momentum > 1e-8)
        ) {
          this.bodies = saved!;
          this.end({
            type: 'numerical',
            message: '守恒误差超过可信阈值，停止本轮而不判定物理解体',
            bodyIds: [],
          });
          break;
        }
        this.time += dt;
        this.steps++;
        this.minStep = Math.min(this.minStep, dt);
        this.lastStep = dt;
        this.accumulator = Math.max(0, this.accumulator - dt);
        this.macroRemaining = Math.max(0, this.macroRemaining - dt);
        this.encounters.update(this.bodies);
        if (endCollision || (!this.adaptive && swept)) {
          this.end((endCollision ?? swept)!);
          break;
        }
        this.tidal = this.tideModel.enabled
          ? readPlanetTides(this.bodies, this.config, this.tideModel)
          : null;
        if (this.tidal && this.tideMonitor.sample(this.tidal, dt, this.tideModel)) {
          const planet = this.bodies.find((b) => b.kind === 'planet')!;
          this.end({
            type: 'tidal',
            message: `${planet.name} 潮汐撕裂：主导恒星 ${this.bodies.find((b) => b.id === this.tidal!.dominantStarId)?.name ?? this.tidal.dominantStarId}，多星潮汐场持续超过结构阈值`,
            bodyIds: [planet.id, ...this.tidal.contributors],
            dominantStarId: this.tidal.dominantStarId ?? undefined,
            tidalRatio: this.tidal.ratio,
          });
          break;
        }
        const candidates = new Set(escapeCandidates(this.bodies, this.config));
        for (const id of this.escaping.keys()) if (!candidates.has(id)) this.escaping.delete(id);
        for (const id of candidates) {
          const since = this.escaping.get(id) ?? this.time;
          this.escaping.set(id, since);
          if (this.time - since >= this.config.escapeConfirmationTime) {
            this.end({
              type: 'escape',
              message: `${this.bodies.find((b) => b.id === id)?.name ?? id} 已确认远距离逃逸`,
              bodyIds: [id],
            });
            break;
          }
        }
        if (this.reason) break;
      }
    } catch {
      this.end({
        type: 'numerical',
        message: '无法在精度预算内解析近距离交会或积分器异常，已安全停止',
        bodyIds: [],
      });
    }
    if (attempts >= this.config.maxStepsPerFrame) this.limited = true;
    // Keep the current partial macro step. Discard backlog, never increase dt or force-correct an orbit.
    if (this.accumulator >= quantum) {
      const keep = this.macroRemaining + ((this.accumulator - this.macroRemaining) % quantum);
      this.droppedTime += this.accumulator - keep;
      this.accumulator = keep;
    }
    this.cpuMs = performance.now() - started;
  }
  snapshot(): SimulationSnapshot {
    const energy = totalEnergy(this.bodies, this.config),
      error = errors(this.initial, this.bodies, this.config);
    return {
      bodies: copyBodies(this.bodies),
      seed: this.seed,
      time: this.time,
      years: this.time / UNITS_PER_YEAR,
      generation: this.generation,
      phase: this.reason ? 'ended' : 'running',
      reason: this.reason ? { ...this.reason } : null,
      restartIn: this.reason ? Math.max(0, this.nextRestartAt - this.wallTime) : 0,
      restartCount: this.restartCount,
      autoRestartBlocked: this.autoRestartBlocked,
      steps: this.steps,
      droppedTime: this.droppedTime,
      energy,
      relativeEnergyError: error.energy,
      events: this.history,
      controls: { ...this.controls },
      diagnostics: {
        momentumError: error.momentum,
        angularMomentumError: error.angularMomentum,
        minStep: Number.isFinite(this.minStep) ? this.minStep : 0,
        lastStep: this.lastStep,
        rejected: this.adaptive?.rejected ?? 0,
        encounters: this.encounters.count,
        exchanges: this.encounters.exchanges,
        cpuMs: this.cpuMs,
        limited: this.limited,
      },
      integrator: this.adaptive?.id ?? this.integrator.id,
      tidal: this.tidal,
      waitingForInitial: this.waitingForInitial,
    };
  }
  getEndedDuration(): number {
    return this.reason ? this.wallTime - this.endedAt : 0;
  }
}
