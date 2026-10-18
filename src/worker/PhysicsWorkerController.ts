import { DEFAULT_CAGE, validateCage } from '../physics/cage';
import { SimulationEngine, type SimulationControls } from '../simulation/SimulationEngine';
import { RandomInitializer } from '../physics/initialConditions';
import { TrajectoryRecorder } from '../physics/trajectory';
import type { PhysicsRequest, PhysicsResponse } from './protocol';
/** One engine, no candidate jobs or background screening timers. */
export class PhysicsWorkerController {
  private engine: SimulationEngine | null = null;
  private readonly trajectory = new TrajectoryRecorder();
  private masses: number[] = [];
  private nextScale = 3;
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
        this.masses = [...message.masses];
        if (message.galaxyScale !== undefined) this.setNextScale(message.galaxyScale);
        if (message.type === 'init') {
          this.controls = message.controls;
          this.engine = new SimulationEngine(message.seed, {
            config: { galaxyScale: this.nextScale, cage: { ...(message.cage ?? DEFAULT_CAGE) } },
            generator: {
              mode: 'random',
              generate: (seed, config) => {
                config.galaxyScale = this.nextScale;
                return new RandomInitializer(this.masses).generate(seed, config);
              },
            },
            session: message.session,
            onAcceptedState: (bodies, time, generation) =>
              this.trajectory.capture(bodies, time, generation),
          });
        } else this.engine?.reset(message.seed);
        this.engine?.setControls(this.controls);
        this.emit();
      } else if (message.type === 'configure') {
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
        if (this.active) this.engine?.advance(message.elapsed, this.budgetMs);
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
    const eventId = snapshot.events[0]?.id ?? 0;
    const eventsUnchanged = eventId === this.lastEventId;
    this.lastEventId = eventId;
    if (eventsUnchanged) snapshot.events = [];
    const trails = this.trajectory.drain();
    this.send(
      { type: 'snapshot', snapshot, sequence, workerCpuMs: cpuMs, eventsUnchanged, trails },
      [trails.points.buffer as ArrayBuffer],
    );
  }
  dispose(): void {
    this.disposed = true;
    this.engine = null;
  }
}
