import { EventBus, type AppEvents, type SimulationEvent } from '../events/EventBus';
import {
  detectCollision,
  escapeCandidates,
  isValidSystem,
  type EndReason,
} from '../physics/detection';
import { totalEnergy } from '../physics/gravity';
import { RandomInitializer } from '../physics/initialConditions';
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
export interface SimulationControls {
  paused: boolean;
  speed: number;
  autoRestart: boolean;
}
export interface SimulationSnapshot {
  bodies: Body[];
  seed: string;
  time: number;
  years: number;
  generation: number;
  phase: 'running' | 'ended';
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
}
export class SimulationEngine {
  readonly config: PhysicsConfig;
  readonly events: EventBus<AppEvents>;
  private bodies: Body[] = [];
  private seed = '';
  private time = 0;
  private accumulator = 0;
  private wallTime = 0;
  private generation = 0;
  private restartCount = 0;
  private steps = 0;
  private droppedTime = 0;
  private initialEnergy = 0;
  private reason: EndReason | null = null;
  private endedAt = 0;
  private nextRestartAt = 0;
  private recentRestarts: number[] = [];
  private autoRestartBlocked = false;
  private escaping = new Map<string, number>();
  private history: SimulationEvent[] = [];
  private eventId = 0;
  private controls: SimulationControls = { paused: false, speed: 1, autoRestart: true };
  constructor(
    seed = 'TRISOLARIS-001',
    options: {
      config?: Partial<PhysicsConfig>;
      generator?: InitialConditionGenerator;
      integrator?: Integrator;
      events?: EventBus<AppEvents>;
    } = {},
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
    this.generator = options.generator ?? new RandomInitializer();
    this.integrator = options.integrator ?? new VelocityVerlet();
    this.events = options.events ?? new EventBus<AppEvents>();
    this.start(seed, 'started');
  }
  private readonly generator: InitialConditionGenerator;
  private readonly integrator: Integrator;
  /** Read-only by convention; renderers never mutate physics objects. */
  getBodies(): readonly Body[] {
    return this.bodies;
  }
  getTime(): number {
    return this.time;
  }
  getGeneration(): number {
    return this.generation;
  }
  getInterpolationAlpha(): number {
    return this.accumulator / this.config.timeStep;
  }
  setControls(patch: Partial<SimulationControls>): void {
    if (
      patch.speed !== undefined &&
      (!Number.isFinite(patch.speed) || patch.speed < 0.1 || patch.speed > 20)
    )
      throw new Error('Speed must be 0.1–20');
    this.controls = {
      paused: patch.paused ?? this.controls.paused,
      speed: patch.speed ?? this.controls.speed,
      autoRestart: patch.autoRestart ?? this.controls.autoRestart,
    };
    if (patch.paused !== undefined) this.accumulator = 0;
  }
  reset(seed = this.seed): void {
    this.autoRestartBlocked = false;
    this.recentRestarts = [];
    this.restartCount++;
    this.start(seed, 'reset');
  }
  private record(type: SimulationEvent['type'], message: string): void {
    const event = {
      id: ++this.eventId,
      type,
      seed: this.seed,
      years: this.time / UNITS_PER_YEAR,
      message,
    };
    this.history = [event, ...this.history].slice(0, 60);
    this.events.emit('simulation', event);
  }
  private start(seed: string, type: 'started' | 'reset'): void {
    this.seed = seed;
    this.time = 0;
    this.steps = 0;
    this.accumulator = 0;
    this.droppedTime = 0;
    this.reason = null;
    this.escaping.clear();
    this.generation++;
    this.bodies = this.generator.generate(seed, this.config);
    this.initialEnergy = totalEnergy(this.bodies, this.config);
    this.record(type, type === 'started' ? '新一轮引力模拟已开始' : '已重置初始条件');
    this.checkSystem();
  }
  private end(reason: EndReason): void {
    if (this.reason) return;
    this.reason = reason;
    this.endedAt = this.wallTime;
    // Two-second notification, at least eight wall seconds between automatic restarts.
    this.nextRestartAt = Math.max(this.wallTime + 2, (this.recentRestarts.at(-1) ?? -Infinity) + 8);
    this.record('ended', reason.message);
    this.events.emit('termination', reason);
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
  /** Elapsed ACTIVE wall seconds; host must discard hidden-page intervals. No DOM dependency. */
  advance(elapsed: number): void {
    if (!Number.isFinite(elapsed) || elapsed <= 0 || this.controls.paused) return;
    const frame = Math.min(elapsed, 0.25);
    this.wallTime += frame;
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
          this.recentRestarts.push(this.wallTime);
          this.restartCount++;
          this.start(String(hashSeed(`${this.seed}:next`)), 'started');
        }
      }
      return;
    }
    const requested = frame * this.config.unitsPerSecond * this.controls.speed;
    this.droppedTime += (elapsed - frame) * this.config.unitsPerSecond * this.controls.speed;
    this.accumulator += requested;
    let count = 0;
    try {
      while (
        this.accumulator + 1e-12 >= this.config.timeStep &&
        count < this.config.maxStepsPerFrame
      ) {
        if (!this.checkSystem()) break;
        const previous = this.bodies.map((b) => [...b.position] as [number, number, number]);
        this.integrator.step(this.bodies, this.config.timeStep, this.config);
        this.time += this.config.timeStep;
        this.steps++;
        count++;
        this.accumulator = Math.max(0, this.accumulator - this.config.timeStep);
        if (!this.checkSystem()) break;
        const collision = detectCollision(this.bodies, previous);
        if (collision) {
          this.end(collision);
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
      this.end({ type: 'numerical', message: '积分器出现异常，模拟已安全停止', bodyIds: [] });
    }
    if (this.accumulator >= this.config.timeStep) {
      const remainder = this.accumulator % this.config.timeStep;
      this.droppedTime += this.accumulator - remainder;
      this.accumulator = remainder;
    }
  }
  snapshot(): SimulationSnapshot {
    const energy = totalEnergy(this.bodies, this.config);
    return {
      bodies: copyBodies(this.bodies),
      seed: this.seed,
      time: this.time,
      years: this.time / UNITS_PER_YEAR,
      generation: this.generation,
      phase: this.reason ? 'ended' : 'running',
      reason: this.reason,
      restartIn: this.reason ? Math.max(0, this.nextRestartAt - this.wallTime) : 0,
      restartCount: this.restartCount,
      autoRestartBlocked: this.autoRestartBlocked,
      steps: this.steps,
      droppedTime: this.droppedTime,
      energy,
      relativeEnergyError:
        (energy - this.initialEnergy) / Math.max(Math.abs(this.initialEnergy), 1e-12),
      events: this.history,
      controls: { ...this.controls },
    };
  }
  getEndedDuration(): number {
    return this.reason ? this.wallTime - this.endedAt : 0;
  }
}
