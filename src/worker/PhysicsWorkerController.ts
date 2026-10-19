import { DEFAULT_CAGE, validateCage } from '../physics/cage';
import { SimulationEngine, type SimulationControls } from '../simulation/SimulationEngine';
import { OriginalRandomInitializer } from '../physics/originalInitializer';
import { V04_DEFAULTS, validateV04, type V04Settings } from '../environment/config';
import { TrajectoryRecorder } from '../physics/trajectory';
import type { PhysicsRequest, PhysicsResponse } from './protocol';
/** One engine, no candidate jobs or background screening timers. */
export class PhysicsWorkerController {
  private engine: SimulationEngine | null = null;
  private readonly trajectory = new TrajectoryRecorder();
  private masses: number[] = [];
  private nextScale = 3;
  private environmentConfig: V04Settings = { ...V04_DEFAULTS };
  private initialEnvironment: V04Settings = { ...V04_DEFAULTS };
  private lastEnvironmentRevision = -1;
  private controls: SimulationControls = { paused: false, speed: 1, autoRestart: true };
  private active = true;
  private disposed = false;
  private budgetMs = 4;
  private lastEventId = -1;
  constructor(
    private readonly send: (message: PhysicsResponse, transfer?: Transferable[]) => void,
  ) {}
  receive(message: PhysicsRequest): void {
    if (this.disposed) return;
    try {
      if (message.type === 'init' || message.type === 'reset') {
        if (
          message.masses.length !== 3 ||
          !message.masses.every((m) => Number.isFinite(m) && m >= 0.08 && m <= 3)
        )
          throw new Error('Invalid stellar masses');
        if (message.environment) {
          validateV04(message.environment);
          this.environmentConfig = { ...message.environment };
        }
        this.masses = [...message.masses];
        if (message.galaxyScale !== undefined) this.setNextScale(message.galaxyScale);
        if (message.type === 'init') {
          this.controls = message.controls;
          this.engine = new SimulationEngine(message.seed, {
            seedMode: message.seedMode,
            environment: this.environmentConfig,
            config: { galaxyScale: this.nextScale, cage: { ...(message.cage ?? DEFAULT_CAGE) } },
            generator: {
              mode: 'random',
              generate: (seed, config) => {
                config.galaxyScale = this.nextScale;
                this.initialEnvironment = { ...this.environmentConfig };
                return new OriginalRandomInitializer(this.masses, this.initialEnvironment).generate(
                  seed,
                  config,
                );
              },
            },
            session: message.session,
            onAcceptedState: (bodies, time, generation) =>
              this.trajectory.capture(bodies, time, generation),
          });
        } else {
          if (message.controls) this.controls = message.controls;
          this.engine?.environment.configure(
            this.environmentConfig,
            this.engine.config.cage?.enabled ?? false,
          );
          this.engine?.setControls(this.controls);
          this.engine?.reset(message.seed, undefined, message.seedMode);
        }
        this.engine?.setControls(this.controls);
        this.emit();
      } else if (message.type === 'configure') {
        if (message.environment) {
          validateV04(message.environment);
          this.environmentConfig = { ...message.environment };
        }
        this.engine?.environment.configure(this.environmentConfig, message.cage.enabled);
        validateCage(message.cage);
        this.setNextScale(message.galaxyScale);
        this.engine?.setCage(message.cage);
        this.emit();
      } else if (message.type === 'controls') {
        this.controls = message.controls;
        this.engine?.setControls(this.controls);
        this.emit();
      } else if (message.type === 'visibility') this.active = message.active;
      else if (message.type === 'tick') {
        const before = performance.now();
        if (this.active) this.engine?.advance(message.elapsed, this.budgetMs, message.wallElapsed);
        const cpuMs = performance.now() - before;
        // Reduce wall-time budget under load, never weaken numerical error tolerances.
        this.budgetMs = Math.max(1, Math.min(4, this.budgetMs + (cpuMs > 5 ? -0.4 : 0.05)));
        this.emit(message.sequence, cpuMs);
      }
    } catch (error) {
      this.send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Worker physics error',
      });
    }
  }
  private setNextScale(scale: number): void {
    if (!Number.isFinite(scale) || scale < 1 || scale > 10)
      throw new Error('Galaxy scale must be 1–10');
    this.nextScale = scale;
  }
  private emit(sequence?: number, cpuMs = 0): void {
    if (!this.engine) return;
    const snapshot = this.engine.snapshot();
    snapshot.initialization = {
      referenceMasses: [...this.masses],
      environment: { ...this.initialEnvironment },
      galaxyScale: snapshot.system!.galaxyScale,
    };
    const eventId = snapshot.events[0]?.id ?? 0;
    const eventsUnchanged = eventId === this.lastEventId;
    this.lastEventId = eventId;
    if (eventsUnchanged) snapshot.events = [];
    const env = snapshot.environment!;
    const environmentHistoryUnchanged = env.historyRevision === this.lastEnvironmentRevision;
    this.lastEnvironmentRevision = env.historyRevision;
    if (environmentHistoryUnchanged)
      snapshot.environment = {
        ...env,
        events: [],
        records: [],
        eras: [],
        ranking: [],
        sessionRanking: [],
      };
    const trails = this.trajectory.drain();
    this.send(
      {
        type: 'snapshot',
        snapshot,
        sequence,
        workerCpuMs: cpuMs,
        eventsUnchanged,
        environmentHistoryUnchanged,
        trails,
      },
      [trails.points.buffer as ArrayBuffer],
    );
  }
  dispose(): void {
    this.disposed = true;
    this.engine = null;
  }
}
